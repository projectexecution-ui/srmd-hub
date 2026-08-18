// The Telegram-side brain for budget approvals: it turns a button tap or a typed
// reply into a call on the secure engine (cc_tg_signoff / cc_tg_release), which
// runs the LIVE approval as the tapper. Everything here is identity- and
// state-safe: the approver is resolved server-side from the Telegram id Telegram
// authenticated (never from the callback payload), the toggle is re-checked, and
// [IB] Internal-Estimate sheets are refused outright.

import type { SupabaseClient } from '@supabase/supabase-js'
import { CB_PREFIX, approvalKeyboard, confirmReleaseKeyboard } from './cc-approval-send'
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

/**
 * Handle an inline-button tap. Returns true if it was ours (so the route can
 * stop). Verb grammar: ccapv:sign|rel|relok|cancel:<wsId>.
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

  // ── Test cards (dry-run to your own chat): validate the plumbing + identity,
  //     then confirm WITHOUT touching the sheet. ──
  if (verb === 'tsign') {
    if (status !== 'submitted' && status !== 'ph_approved') {
      await answerCbq(token, cbq.id, 'This budget is not at a sign-off stage.', true)
      return true
    }
    await answerCbq(token, cbq.id, 'Test OK ✔')
    await sendMessage(token, chatId,
      `✅ Test OK — the buttons work and you're recognised as an approver. The real Approve on ${wsCode} would ask for your checked amount and sign it off. Nothing was changed.`)
    return true
  }
  if (verb === 'trel') {
    if (status !== 'atm_approved' && status !== 'partially_approved') {
      await answerCbq(token, cbq.id, 'This budget is not ready for release.', true)
      return true
    }
    await answerCbq(token, cbq.id, 'Test OK ✔')
    await sendMessage(token, chatId,
      `✅ Test OK — the real "Approve & release" on ${wsCode} would release the budget into ERP. Nothing was changed.`)
    return true
  }

  if (verb === 'sign') {
    if (status !== 'submitted' && status !== 'ph_approved') {
      await answerCbq(token, cbq.id, 'This budget has already moved on.', true)
      await editMarkup(token, chatId, messageId, { inline_keyboard: [] })
      return true
    }
    // Remember what they're approving; the next numeric reply completes it.
    await svc.from('tg_pending_approvals').delete().eq('chat_id', String(chatId)).eq('action', 'signoff')
    await svc.from('tg_pending_approvals').insert({
      chat_id: String(chatId), user_id: actor, ws_id: wsId, action: 'signoff', stage: status,
    })
    await sendMessage(token, chatId,
      `Reply with the amount you have checked (₹) for ${wsCode}. This is your own independent figure — the same as signing off in the app.`,
      { reply_markup: { force_reply: true, input_field_placeholder: 'e.g. 334754' } })
    await answerCbq(token, cbq.id, 'Type the amount you checked ↓')
    return true
  }

  if (verb === 'rel') {
    if (status !== 'atm_approved' && status !== 'partially_approved') {
      await answerCbq(token, cbq.id, 'This budget is not ready for release.', true)
      await editMarkup(token, chatId, messageId, { inline_keyboard: [] })
      return true
    }
    await editMarkup(token, chatId, messageId, confirmReleaseKeyboard(wsId))
    await answerCbq(token, cbq.id, 'Confirm the release ↓')
    return true
  }

  if (verb === 'cancel') {
    await editMarkup(token, chatId, messageId, approvalKeyboard(status as ApprovalStage, wsId))
    await answerCbq(token, cbq.id, 'Cancelled.')
    return true
  }

  if (verb === 'relok') {
    const { data: res, error } = await svc.rpc('cc_tg_release', { p_actor: actor, p_ws_id: wsId, p_tranche: null })
    if (error) {
      await answerCbq(token, cbq.id, error.message, true)
      await editMarkup(token, chatId, messageId, approvalKeyboard('atm_approved', wsId))
      return true
    }
    const r = res as { released?: number; new_status?: string }
    await editMarkup(token, chatId, messageId, { inline_keyboard: [] })
    await sendMessage(token, chatId,
      `✅ Released ${inr(r.released ?? 0)} — ${wsCode} is now ${prettyStage(r.new_status ?? 'approved')}. Recorded in CT Hub.`)
    await answerCbq(token, cbq.id, 'Approved ✔')
    return true
  }

  await answerCbq(token, cbq.id, 'Unknown action.')
  return true
}

/**
 * A plain (non-command) private message. If the chat has a pending sign-off
 * waiting for a typed amount, treat this as that amount and run the sign-off.
 * Returns true if it consumed the message.
 */
export async function handleApprovalAmountReply(
  svc: SupabaseClient, token: string, chatId: string | number, tgUserId: string | number, text: string,
): Promise<boolean> {
  const { data: pend } = await svc
    .from('tg_pending_approvals')
    .select('id, user_id, ws_id, stage, expires_at')
    .eq('chat_id', String(chatId))
    .eq('action', 'signoff')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!pend) return false
  // Expired → clear + tell them to tap again.
  if (new Date(pend.expires_at as string).getTime() < Date.now()) {
    await svc.from('tg_pending_approvals').delete().eq('id', pend.id)
    await sendMessage(token, chatId, 'That approval prompt expired — tap Approve on the budget card again.')
    return true
  }

  const amt = Number(text.replace(/[^0-9.]/g, ''))
  if (!isFinite(amt) || amt <= 0) {
    await sendMessage(token, chatId, 'That does not look like an amount. Reply with just the number, e.g. 334754.')
    return true
  }

  const actor = await resolveActor(svc, tgUserId)
  if (!actor || actor !== pend.user_id) {
    await sendMessage(token, chatId, 'Only the person this budget is waiting on can sign it off here.')
    return true
  }

  const { data: res, error } = await svc.rpc('cc_tg_signoff', {
    p_actor: actor, p_ws_id: pend.ws_id, p_checked_amt: amt, p_note: null,
  })
  await svc.from('tg_pending_approvals').delete().eq('id', pend.id)
  if (error) {
    await sendMessage(token, chatId, `Could not sign off: ${error.message}`)
    return true
  }
  const r = res as { new_status?: string; ws_code?: string }
  await sendMessage(token, chatId,
    `✅ Signed off ${inr(amt)} — ${r.ws_code ?? 'budget'} now moves to ${prettyStage(r.new_status ?? '')}. Recorded in CT Hub.`)
  return true
}
