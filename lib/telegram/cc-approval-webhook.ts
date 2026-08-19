// The Telegram-side brain for budget approvals: it turns a button tap or a typed
// reply into a call on the secure engine (cc_tg_signoff / cc_tg_release), which
// runs the LIVE approval as the tapper. Everything here is identity- and
// state-safe: the approver is resolved server-side from the Telegram id Telegram
// authenticated (never from the callback payload), the toggle is re-checked, and
// [IB] Internal-Estimate sheets are refused outright.

import type { SupabaseClient } from '@supabase/supabase-js'
import { CB_PREFIX, approvalKeyboard, waitingKeyboard } from './cc-approval-send'
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
    .select('ws_code, status, summary_notes')
    .eq('id', wsId)
    .maybeSingle()
  if (!ws) { await answerCbq(token, cbq.id, 'That budget could not be found.', true); return true }
  if ((ws.summary_notes as string | null)?.startsWith('[IB')) {
    await answerCbq(token, cbq.id, 'This is an Internal Estimate — approve it inside CT Hub.', true)
    return true
  }
  const status = ws.status as string
  const wsCode = (ws.ws_code as string) || 'budget'
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

  // ── Test cards (dry-run to your own chat): validate the plumbing + identity,
  //     then confirm WITHOUT touching the sheet. ──
  if (verb === 'tsign') {
    if (!isSignStage) { await answerCbq(token, cbq.id, 'This budget is not at a sign-off stage.', true); return true }
    await answerCbq(token, cbq.id, 'Test OK ✔')
    await sendMessage(token, chatId,
      `✅ Test OK — the buttons work and you're recognised as an approver. The real Approve on ${wsCode} would ask for your checked amount and sign it off. Nothing was changed.`)
    return true
  }
  if (verb === 'trel') {
    if (!isReleaseStage) { await answerCbq(token, cbq.id, 'This budget is not ready for release.', true); return true }
    await answerCbq(token, cbq.id, 'Test OK ✔')
    await sendMessage(token, chatId,
      `✅ Test OK — the real "Approve & release" on ${wsCode} would release the budget into ERP. Nothing was changed.`)
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
      card_message_id: messageId,
    })
    await editMarkup(token, chatId, messageId, waitingKeyboard(wsId))
    await sendMessage(token, chatId,
      `Reply with the amount you checked AND a short remark for ${wsCode} — e.g. “334754 rates verified, approved”. Both are required (the amount is your own independent figure, same as in the app).`,
      { reply_markup: { force_reply: true, input_field_placeholder: 'e.g. 334754 rates verified' } })
    await answerCbq(token, cbq.id, 'Reply with the amount + remark ↓')
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
    .select('id, user_id, ws_id, action, expires_at, card_message_id')
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
    // "<amount> <remark>" — leading number, then the mandatory remark.
    const m = raw.match(/^[₹\s]*([0-9][0-9,]*(?:\.[0-9]+)?)\s+([\s\S]+)$/)
    if (!m) {
      await sendMessage(token, chatId, /[0-9]/.test(raw)
        ? 'Add a short remark after the amount — e.g. “334754 rates verified”.'
        : 'Reply with the amount you checked, then a remark — e.g. “334754 rates verified”.')
      return true
    }
    amt = Number(m[1].replace(/,/g, ''))
    remark = m[2].trim()
    if (!isFinite(amt) || amt <= 0) {
      await sendMessage(token, chatId, 'That amount does not look right. Reply like “334754 rates verified”.')
      return true
    }
    if (remark.length < 2) {
      await sendMessage(token, chatId, 'Add a short remark after the amount (required).')
      return true
    }
  }

  // Claim the prompt atomically BEFORE acting, so a racing second reply can't
  // run a second action — only the reply that deletes the row proceeds.
  const { data: claimed } = await svc.from('tg_pending_approvals').delete().eq('id', pend.id).select('id')
  if (!claimed || claimed.length === 0) return true
  const cardMsgId = pend.card_message_id != null ? Number(pend.card_message_id) : null
  const clearCard = async () => { if (cardMsgId != null) await editMarkup(token, chatId, cardMsgId, { inline_keyboard: [] }) }

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
  return true
}
