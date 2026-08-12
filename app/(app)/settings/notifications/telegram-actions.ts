'use server'
// Server actions for the "Connect Telegram" card. startTelegramLink mints a
// one-time code (telegram_link_start RPC, keyed to the signed-in user) and
// builds the bot deep-link; the user taps Start in Telegram and the webhook
// binds their chat. unlinkTelegram turns it back off.

import { createClient } from '@/lib/supabase/server'

async function botUsername(token: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const j = await r.json() as { ok?: boolean; result?: { username?: string } }
    return j.ok ? (j.result?.username ?? null) : null
  } catch { return null }
}

export async function startTelegramLink():
  Promise<{ ok: true; link: string; botUsername: string } | { ok: false; error: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) {
    return { ok: false, error: 'Telegram isn’t set up yet — the admin needs to add the bot token on the server first.' }
  }
  const supabase = await createClient()
  const { data: code, error } = await supabase.rpc('telegram_link_start')
  if (error || !code) return { ok: false, error: error?.message ?? 'Could not start linking — please try again.' }
  const username = await botUsername(token)
  if (!username) return { ok: false, error: 'Could not reach the Telegram bot. Ask the admin to check the bot token / setup.' }
  return { ok: true, link: `https://t.me/${username}?start=${code}`, botUsername: username }
}

export async function unlinkTelegram(): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.rpc('telegram_unlink')
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
