// The Telegram-side brain for budget approvals: it turns a button tap or a typed
// reply into a call on the secure engine (cc_tg_signoff / cc_tg_release), which
// runs the LIVE approval as the tapper. Everything here is identity- and
// state-safe: the approver is resolved server-side from the Telegram id Telegram
// authenticated (never from the callback payload), the toggle is re-checked, and
// [IB] Internal-Estimate sheets are refused outright.

import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import { CB_PREFIX, approvalKeyboard, waitingKeyboard } from './cc-approval-send'
import { dispatchCardsForSheet } from './cc-approval-dispatch'
import type { ApprovalStage } from '@/lib/cost-control/approval-card'

const api = (token: string, m: string) => `https://api.telegram.org/bot${token}/${m}`
const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN')

async function tg(token: string, method: string, body: object): Promise<void> {
  try {
    await fetch(api(token, method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch { /* best-effort */ }
}
const answerCbq = (token: string, id: string, text?: string, alert = false) =>
  tg(token, 'answerCallbackQuery', { callback_query_id: id, text: text?.slice(0, 190), show_alert: alert })
const sendMessage = (token: string, chatId: string | number, text: string, extra: object = {}) =>
  tg(token, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra })
const editMarkup = (token: string, chatId: string | number, messageId: number, keyboard: object) =>
  tg(token, 'editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: keyboard })

function prettyStage(s: string): string {
  return s === 'ph_approved' ? 'the Atm Head'
    : s === 'atm_approved' ? 'the Trustee (for release)'
    : s === 'approved' ? 'fully approved'
    : s === 'partially_approved' ? 'partially released'
    : s
}

/** Resolve the CT Hub user behind a Telegram id (private chat: from.id == chat.id).
 *  Only a connected, telegram-enabled account maps back. */
async function resolveActor(svc: SupabaseClient, tgUserId: string | number): Promise<string | null> {
  const { data } = await svc
    .from('notification_preferences')
    .select('user_id, telegram')
    .eq('telegram_chat_id', String(tgUserId))
    .maybeSingle()
  if (!data || data.telegram === false) return null
  return data.user_id as string
}

async function approvalsEnabled(svc: SupabaseClient): Promise<boolean> {
  const { data } = await svc.from('app_settings').select('value').eq('key', 'cc_telegram_approvals').maybeSingle()
  const v = (data?.value as string | null) ?? ''
  return v === 'true' || v === '1' || v === 'on'
}

interface CallbackQuery {
  id: string
  data?: string
  from?: { id?: number | string }
  message?: { message_id?: number; chat?: { id?: number | string } }
}

// A release RPC failure caused by the sheet already having moved reads as
// "already done" to the tapper, not as a scary error (double-taps hit this).
function friendlyReleaseError(msg: string): string {
  const m = (msg || '').toLowerCase()
  if (m.includes('atm_approved') || m.includes('released') || m.includes('already') || m.includes('only sheets')) {
    return 'This budget was already released or has moved on ✓'
  }
  return msg
}

/**
 * Handle an inline-button tap. Returns true if it was ours (so the route can
 * stop). Verb grammar: ccapv:sign|wait|scancel|rel|relok|cancel:<wsId>.
 *
 * Repeated / accidental taps are safe: the moment a real action is taken the
 * buttons are swapped or removed so they can't re-fire, and any tap on a sheet
 * that has already moved answers "already done ✓" instead of erroring.
 */
export async function handleApprovalCallback(
  svc: SupabaseClient, token: string, cbq: CallbackQuery,
): Promise<boolean> {
  const data = cbq.data ?? ''
  if (!data.startsWith(`${CB_PREFIX}:`)) return false
  const [, verb, wsId] = data.split(':')
  const chatId = cbq.message?.chat?.id
  const messageId = cbq.message?.message_id
  const tgUser = cbq.from?.id
  if (!wsId || chatId == null || messageId == null || tgUser == null) {
    await answerCbq(token, cbq.id, 'Something went wrong — open CT Hub to act.')
    return true
  }
  const clearButtons = () => editMarkup(token, chatId, messageId, { inline_keyboard: [] })

  if (!(await approvalsEnabled(svc))) {
    await answerCbq(token, cbq.id, 'Telegram approvals are turned off in CT Hub.', true)
    return true
  }
  const actor = await resolveActor(svc, tgUser)
  if (!actor) {
    await answerCbq(token, cbq.id, 'Your Telegram is not linked to a CT Hub account.', true)
    return true
  }

  // Current state of the sheet (also blocks [IB]).
  const { data: ws } = await svc
    .from('cc_working_sheets')
    .select('ws_code, status, summary_notes, total_amount')
    .eq('id', wsId)
    .maybeSingle()
  if (!ws) { await answerCbq(token, cbq.id, 'That budget could not be found.', true); return true }
  if ((ws.summary_notes as string | null)?.startsWith('[IB')) {
    await answerCbq(token, cbq.id, 'This is an Internal Estimate — approve it inside CT Hub.', true)
    return true
  }
  const status = ws.status as string
  const wsCode = (ws.ws_code as string) || 'budget'
  const askAmount = Number(ws.total_amount ?? 0)
  const isSignStage = status === 'submitted' || status === 'ph_approved'
  const isReleaseStage = status === 'atm_approved' || status === 'partially_approved'

  // Is there a live (unexpired) prompt waiting for this exact sheet (sign-off
  // amount+remark, or release remark)?
  async function freshPending(): Promise<boolean> {
    const { data: p } = await svc
      .from('tg_pending_approvals')
      .select('expires_at')
      .eq('chat_id', String(chatId)).eq('ws_id', wsId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    return !!p && new Date(p.expires_at as string).getTime() > Date.now()
  }

  // ── Test cards (dry-run to your own chat): run the SAME flow as the real
  //     buttons — lock the card, ask for the amount+remark / remark — but marked
  //     is_test, so the typed reply just confirms "Test OK" and changes nothing.
  //     This lets you feel the compulsory comment + the tap-locking for real. ──
  if (verb === 'tsign') {
    if (!isSignStage) { await answerCbq(token, cbq.id, 'This budget is not at a sign-off stage.', true); await clearButtons(); return true }
    if (await freshPending()) {
      await answerCbq(token, cbq.id, 'Already asked — reply with the amount + remark above ↑')
      await editMarkup(token, chatId, messageId, waitingKeyboard(wsId))
      return true
    }
    await svc.from('tg_pending_approvals').delete().eq('chat_id', String(chatId))
    await svc.from('tg_pending_approvals').insert({
      chat_id: String(chatId), user_id: actor, ws_id: wsId, action: 'signoff', stage: status,
      card_message_id: messageId, is_test: true, ask_amount: askAmount,
    })
    await editMarkup(token, chatId, messageId, waitingKeyboard(wsId))
    await sendMessage(token, chatId,
      `TEST — ${inr(askAmount)} to be approved for ${wsCode}. Just reply with your remark (e.g. “rates verified”). Dry run — nothing changes.`,
      { reply_markup: { force_reply: true, input_field_placeholder: 'your remark' } })
    await answerCbq(token, cbq.id, 'Reply with your remark ↓')
    return true
  }
  if (verb === 'trel') {
    if (!isReleaseStage) { await answerCbq(token, cbq.id, 'This budget is not ready for release.', true); await clearButtons(); return true }
    if (await freshPending()) {
      await answerCbq(token, cbq.id, 'Already asked — type your remark above ↑')
      await editMarkup(token, chatId, messageId, waitingKeyboard(wsId))
      return true
    }
    await svc.from('tg_pending_approvals').delete().eq('chat_id', String(chatId))
    await svc.from('tg_pending_approvals').insert({
      chat_id: String(chatId), user_id: actor, ws_id: wsId, action: 'release', stage: status,
      card_message_id: messageId, is_test: true,
    })
    await editMarkup(token, chatId, messageId, waitingKeyboard(wsId))
    await sendMessage(token, chatId,
      `TEST — type a short remark to confirm the release of ${wsCode} (e.g. “Checked, release to ERP”). This is a dry run — nothing will change.`,
      { reply_markup: { force_reply: true, input_field_placeholder: 'e.g. Checked, release to ERP' } })
    await answerCbq(token, cbq.id, 'Type a remark to confirm ↓')
    return true
  }

  if (verb === 'sign') {
    if (!isSignStage) {
      await answerCbq(token, cbq.id, 'This budget has already moved on ✓', true)
      await clearButtons()
      return true
    }
    // Already asked? Don't send a second prompt — just point them back to it.
    if (await freshPending()) {
      await answerCbq(token, cbq.id, 'Already asked — reply with the amount above ↑')
      await editMarkup(token, chatId, messageId, waitingKeyboard(wsId))
      return true
    }
    // Remember what they're approving (with the card's message id, to clean it
    // up after), then ask for the amount + remark and lock the card so a re-tap
    // can't fire another prompt. One live prompt per chat.
    await svc.from('tg_pending_approvals').delete().eq('chat_id', String(chatId))
    await svc.from('tg_pending_approvals').insert({
      chat_id: String(chatId), user_id: actor, ws_id: wsId, action: 'signoff', stage: status,
      card_message_id: messageId, ask_amount: askAmount,
    })
    await editMarkup(token, chatId, messageId, waitingKeyboard(wsId))
    await sendMessage(token, chatId,
      `${inr(askAmount)} to be approved for ${wsCode}. Just reply with your remark — e.g. “rates verified, approved”. (Different amount? Type it first: “300000 revised”. Optional: attach a photo/file with the remark as its caption.)`,
      { reply_markup: { force_reply: true, input_field_placeholder: 'your remark' } })
    await answerCbq(token, cbq.id, 'Reply with your remark ↓')
    return true
  }

  if (verb === 'wait') {
    if (await freshPending()) {
      await answerCbq(token, cbq.id, 'Reply with the amount above ↑')
    } else {
      await answerCbq(token, cbq.id, 'This one is already done ✓')
      await clearButtons()
    }
    return true
  }

  if (verb === 'scancel' || verb === 'cancel') {
    await svc.from('tg_pending_approvals').delete().eq('chat_id', String(chatId)).eq('ws_id', wsId)
    if (isSignStage || isReleaseStage) await editMarkup(token, chatId, messageId, approvalKeyboard(status as ApprovalStage, wsId))
    else await clearButtons()
    await answerCbq(token, cbq.id, 'Cancelled.')
    return true
  }

  if (verb === 'rel') {
    if (!isReleaseStage) {
      await answerCbq(token, cbq.id, 'This budget has already moved on ✓', true)
      await clearButtons()
      return true
    }
    if (await freshPending()) {
      await answerCbq(token, cbq.id, 'Already asked — type your remark above ↑')
      await editMarkup(token, chatId, messageId, waitingKeyboard(wsId))
      return true
    }
    // Compulsory remark to confirm the release — the typed remark is both the
    // confirmation (accidental-tap safe) and the record.
    await svc.from('tg_pending_approvals').delete().eq('chat_id', String(chatId))
    await svc.from('tg_pending_approvals').insert({
      chat_id: String(chatId), user_id: actor, ws_id: wsId, action: 'release', stage: status,
      card_message_id: messageId,
    })
    await editMarkup(token, chatId, messageId, waitingKeyboard(wsId))
    await sendMessage(token, chatId,
      `Type a short remark to confirm the release of ${wsCode} (required) — e.g. “Checked, release to ERP”.`,
      { reply_markup: { force_reply: true, input_field_placeholder: 'e.g. Checked, release to ERP' } })
    await answerCbq(token, cbq.id, 'Type a remark to confirm ↓')
    return true
  }

  // Legacy two-tap confirm buttons (from cards sent before the remark flow):
  // honour a "Yes, release" but require nothing typed. New cards never show these.
  if (verb === 'relok') {
    if (!isReleaseStage) {
      await answerCbq(token, cbq.id, 'Already released or moved on ✓', true)
      await clearButtons()
      return true
    }
    await clearButtons()
    const { data: res, error } = await svc.rpc('cc_tg_release', { p_actor: actor, p_ws_id: wsId, p_tranche: null })
    if (error) {
      const msg = friendlyReleaseError(error.message)
      await answerCbq(token, cbq.id, msg, true)
      await sendMessage(token, chatId, `${msg} — open CT Hub if you need to act on ${wsCode}.`)
      return true
    }
    const r = res as { released?: number; new_status?: string }
    await sendMessage(token, chatId,
      `✅ Released ${inr(r.released ?? 0)} — ${wsCode} is now ${prettyStage(r.new_status ?? 'approved')}. Recorded in CT Hub.`)
    await answerCbq(token, cbq.id, 'Approved ✔')
    return true
  }

  await answerCbq(token, cbq.id, 'Unknown action.')
  return true
}

/**
 * A plain (non-command) private message that answers a pending approval prompt:
 * a sign-off needs the checked AMOUNT + a required remark ("334754 rates ok");
 * a release needs a required remark. The remark is mandatory either way and is
 * recorded (sign-off: on the approval trail; release: on the sheet's comments).
 * A bad reply never consumes the prompt — they can just type again.
 */
export async function handleApprovalAmountReply(
  svc: SupabaseClient, token: string, chatId: string | number, tgUserId: string | number, text: string,
): Promise<boolean> {
  const { data: pend } = await svc
    .from('tg_pending_approvals')
    .select('id, user_id, ws_id, action, expires_at, card_message_id, is_test, ask_amount')
    .eq('chat_id', String(chatId))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!pend) return false
  if (new Date(pend.expires_at as string).getTime() < Date.now()) {
    await svc.from('tg_pending_approvals').delete().eq('id', pend.id)
    await sendMessage(token, chatId, 'That approval prompt expired — tap the button on the budget card again.')
    return true
  }

  const actor = await resolveActor(svc, tgUserId)
  if (!actor || actor !== pend.user_id) {
    await sendMessage(token, chatId, 'Only the person this budget is waiting on can act on it here.')
    return true
  }

  const raw = text.trim()
  const isRelease = pend.action === 'release'
  let amt = 0
  let remark = ''

  if (isRelease) {
    remark = raw
    if (remark.length < 3) {
      await sendMessage(token, chatId, 'Add a short remark to confirm the release (required) — e.g. “Checked, release to ERP”.')
      return true
    }
  } else {
    // Amount is prefilled: just a remark → approve the ask amount. Or type
    // "<amount> <remark>" to approve a different amount. A bare number is refused.
    const onlyNum = /^[₹\s]*[0-9][0-9,]*(?:\.[0-9]+)?\s*$/.test(raw)
    if (onlyNum) {
      await sendMessage(token, chatId, 'Add a short remark too — e.g. “rates verified, approved”.')
      return true
    }
    const m = raw.match(/^[₹\s]*([0-9][0-9,]*(?:\.[0-9]+)?)\s+([\s\S]+)$/)
    if (m) { amt = Number(m[1].replace(/,/g, '')); remark = m[2].trim() }
    else { amt = Number(pend.ask_amount ?? 0); remark = raw }
    if (!isFinite(amt) || amt <= 0) {
      await sendMessage(token, chatId, 'The amount to approve is missing — type the amount first, then your remark.')
      return true
    }
    if (remark.length < 2) {
      await sendMessage(token, chatId, 'Add a short remark (required).')
      return true
    }
  }

  // Claim the prompt atomically BEFORE acting, so a racing second reply can't
  // run a second action — only the reply that deletes the row proceeds.
  const { data: claimed } = await svc.from('tg_pending_approvals').delete().eq('id', pend.id).select('id')
  if (!claimed || claimed.length === 0) return true
  const cardMsgId = pend.card_message_id != null ? Number(pend.card_message_id) : null
  const clearCard = async () => { if (cardMsgId != null) await editMarkup(token, chatId, cardMsgId, { inline_keyboard: [] }) }

  // Test dry-run: same UX, but stop here — no engine call, nothing changes.
  if (pend.is_test) {
    await clearCard()
    await sendMessage(token, chatId, isRelease
      ? `✅ Test OK — you'd have released with the remark “${remark}”. Nothing was changed.`
      : `✅ Test OK — you'd have signed off ${inr(amt)} with the remark “${remark}”. Nothing was changed.`)
    return true
  }

  if (isRelease) {
    const { data: res, error } = await svc.rpc('cc_tg_release', { p_actor: actor, p_ws_id: pend.ws_id, p_tranche: null })
    await clearCard()
    if (error) { await sendMessage(token, chatId, `Could not release: ${friendlyReleaseError(error.message)}`); return true }
    const r = res as { released?: number; new_status?: string; ws_code?: string }
    // Record the mandatory remark on the sheet's comment thread.
    try { await svc.from('cc_ws_comments').insert({ ws_id: pend.ws_id, author_id: actor, body: `Released via Telegram — ${remark}` }) } catch { /* best-effort */ }
    await sendMessage(token, chatId,
      `✅ Released ${inr(r.released ?? 0)} — ${r.ws_code ?? 'budget'} is now ${prettyStage(r.new_status ?? 'approved')}. Remark saved. Recorded in CT Hub.`)
    return true
  }

  const { data: res, error } = await svc.rpc('cc_tg_signoff', {
    p_actor: actor, p_ws_id: pend.ws_id, p_checked_amt: amt, p_note: remark,
  })
  await clearCard()
  if (error) { await sendMessage(token, chatId, `Could not sign off: ${error.message}`); return true }
  const r = res as { new_status?: string; ws_code?: string }
  await sendMessage(token, chatId,
    `✅ Signed off ${inr(amt)} — ${r.ws_code ?? 'budget'} now moves to ${prettyStage(r.new_status ?? '')}. Remark saved. Recorded in CT Hub.`)
  // Auto-send the next stage's card to the next connected approver.
  after(() => dispatchCardsForSheet(pend.ws_id as string).catch(() => {}))
  return true
}

function mimeOf(name: string): string {
  const e = (name.split('.').pop() || '').toLowerCase()
  return e === 'pdf' ? 'application/pdf'
    : e === 'png' ? 'image/png' : (e === 'jpg' || e === 'jpeg') ? 'image/jpeg'
    : e === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : e === 'xls' ? 'application/vnd.ms-excel'
    : (e === 'doc' || e === 'docx') ? 'application/msword'
    : 'application/octet-stream'
}

/** Download a Telegram file and save it against the sheet as an approval record
 *  (kind='approval_record'), the same "for record" attachments the app supports. */
async function attachTelegramFile(svc: SupabaseClient, token: string, wsId: string, actor: string, fileId: string, fileName: string | null): Promise<boolean> {
  try {
    const info = (await (await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`)).json()) as { ok?: boolean; result?: { file_path?: string } }
    const fp = info?.result?.file_path
    if (!info.ok || !fp) return false
    const bin = await (await fetch(`https://api.telegram.org/file/bot${token}/${fp}`)).arrayBuffer()
    if (bin.byteLength > 25 * 1024 * 1024) return false
    const { data: ws } = await svc.from('cc_working_sheets').select('project_id').eq('id', wsId).maybeSingle()
    const projectId = ws?.project_id as string | undefined
    if (!projectId) return false
    const base = (fileName && fileName.trim()) || `telegram-${(fp.split('/').pop() || 'file')}`
    const safe = base.replace(/[^A-Za-z0-9._-]/g, '_')
    const path = `${projectId}/approval-tg-${Date.now()}-${safe}`
    const { error: upErr } = await svc.storage.from('cc-sheets').upload(path, Buffer.from(bin), { contentType: mimeOf(safe), upsert: false })
    if (upErr) return false
    await svc.from('cc_ws_attachments').insert({ working_sheet_id: wsId, path, name: base, kind: 'approval_record', uploaded_by: actor })
    return true
  } catch { return false }
}

/**
 * The approver sent a photo/document while a budget is waiting on them: attach
 * it to the sheet as an approval record. If the file carries a caption, that
 * caption is the remark and the approval is finished; otherwise we just confirm
 * the attachment and wait for the remark. Returns true if consumed.
 */
export async function handleApprovalMedia(
  svc: SupabaseClient, token: string, chatId: string | number, tgUserId: string | number,
  fileId: string, fileName: string | null, caption: string,
): Promise<boolean> {
  const { data: pend } = await svc
    .from('tg_pending_approvals')
    .select('id, user_id, ws_id, expires_at, is_test')
    .eq('chat_id', String(chatId))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!pend) return false
  if (new Date(pend.expires_at as string).getTime() < Date.now()) {
    await sendMessage(token, chatId, 'That approval prompt expired — tap the button on the budget card again.')
    return true
  }
  const actor = await resolveActor(svc, tgUserId)
  if (!actor || actor !== pend.user_id) {
    await sendMessage(token, chatId, 'Only the person this budget is waiting on can attach a file here.')
    return true
  }

  if (pend.is_test) {
    if (caption && caption.trim()) return handleApprovalAmountReply(svc, token, chatId, tgUserId, caption)
    await sendMessage(token, chatId, '📎 Test — the file would be attached to the budget. Reply with your remark to finish.')
    return true
  }

  const ok = await attachTelegramFile(svc, token, pend.ws_id as string, actor, fileId, fileName)
  if (!ok) {
    await sendMessage(token, chatId, 'Could not save that attachment — try again, or add it in CT Hub.')
    return true
  }
  // Caption present → it's the remark; attach + finish the approval in one step.
  if (caption && caption.trim()) return handleApprovalAmountReply(svc, token, chatId, tgUserId, caption)
  await sendMessage(token, chatId, '📎 Attached to the budget. Now reply with your remark (or amount + remark) to finish approving.')
  return true
}
