// The ✓ Seen button under every Telegram card. One tap marks the notification
// read in CT Hub (is_read / read_at on notifications), so the bell stops
// counting it — 9 in 10 alerts were never opened in the app because the phone
// already told the person everything.
//
// callback_data is "seen:<notification uuid>". The tapper is resolved from the
// Telegram id Telegram authenticated (never from the payload) and must be the
// notification's own recipient. Idempotent: a second tap just answers "already".

import type { SupabaseClient } from '@supabase/supabase-js'
import { SEEN_PREFIX, type TelegramButton } from './compose'

const api = (token: string, m: string) => `https://api.telegram.org/bot${token}/${m}`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function tg(token: string, method: string, body: object): Promise<void> {
  try {
    await fetch(api(token, method), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch { /* best-effort */ }
}

export interface SeenCallback {
  id: string
  data?: string
  from?: { id?: number | string }
  message?: { message_id?: number; chat?: { id?: number | string }; reply_markup?: { inline_keyboard?: TelegramButton[][] } }
}

/** The keyboard with the Seen button taken out (pure, for the test). */
export function withoutSeen(rows: TelegramButton[][] | undefined): TelegramButton[][] {
  return (rows ?? [])
    .map(r => r.filter(b => !(b.callback_data ?? '').startsWith(`${SEEN_PREFIX}:`)))
    .filter(r => r.length > 0)
}

/** Handle a tap. Returns true when the callback was ours. */
export async function handleSeenCallback(svc: SupabaseClient, token: string, cbq: SeenCallback): Promise<boolean> {
  const data = cbq.data ?? ''
  if (!data.startsWith(`${SEEN_PREFIX}:`)) return false
  const answer = (text: string) => tg(token, 'answerCallbackQuery', { callback_query_id: cbq.id, text: text.slice(0, 190) })

  const notifId = data.slice(SEEN_PREFIX.length + 1)
  const tgUser = cbq.from?.id
  if (!UUID.test(notifId) || tgUser == null) { await answer('Open CT Hub to mark it read.'); return true }

  const { data: pref } = await svc
    .from('notification_preferences').select('user_id').eq('telegram_chat_id', String(tgUser)).maybeSingle()
  const actor = pref?.user_id as string | undefined
  if (!actor) { await answer('Your Telegram is not linked to a CT Hub account.'); return true }

  const { data: n } = await svc.from('notifications').select('id, user_id, is_read').eq('id', notifId).maybeSingle()
  if (!n) { await answer('That notice is gone from CT Hub.'); return true }
  if (n.user_id !== actor) { await answer('This notice is not yours.'); return true }

  if (!n.is_read) {
    const { error } = await svc.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', notifId)
    if (error) { await answer('Could not mark it read — try again.'); return true }
  }
  await answer(n.is_read ? 'Already marked as seen ✓' : 'Marked as seen in CT Hub ✓')

  // Take the button away so the card shows it is done; keep the open button.
  const chatId = cbq.message?.chat?.id
  const messageId = cbq.message?.message_id
  if (chatId != null && messageId != null) {
    await tg(token, 'editMessageReplyMarkup', {
      chat_id: chatId, message_id: messageId,
      reply_markup: { inline_keyboard: withoutSeen(cbq.message?.reply_markup?.inline_keyboard) },
    })
  }
  return true
}
