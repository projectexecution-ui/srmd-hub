// One-click bot setup for an admin. Registers this app's webhook with Telegram
// (so /start /stop reach us) using the bot token, and echoes the bot's username
// back so the UI can build t.me/<bot>?start=<code> links. Session-gated to a
// cost-control admin — the bot token lives only in server env, never exposed.
//
// GET  → status: is the token present, what's the bot username, current webhook.
// POST → (re)register the webhook.

import { NextResponse } from 'next/server'
import { getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function botUsername(token: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`)
    const j = await r.json() as { ok?: boolean; result?: { username?: string } }
    return j.ok ? (j.result?.username ?? null) : null
  } catch { return null }
}

export async function GET() {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return NextResponse.json({ ok: true, configured: false })
  const username = await botUsername(token)
  return NextResponse.json({ ok: true, configured: true, botUsername: username })
}

export async function POST() {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }
  const token = process.env.TELEGRAM_BOT_TOKEN
  const secret = process.env.NOTIFY_INTERNAL_SECRET
  if (!token) return NextResponse.json({ ok: false, reason: 'TELEGRAM_BOT_TOKEN not set on the server' }, { status: 503 })
  if (!secret) return NextResponse.json({ ok: false, reason: 'NOTIFY_INTERNAL_SECRET not set on the server' }, { status: 503 })

  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://ct-hub.vercel.app').replace(/\/$/, '')
  const webhookUrl = `${origin}/api/telegram/webhook`

  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        // 'callback_query' is REQUIRED for the budget-approval buttons — Telegram
        // silently drops button taps for any update type not listed here.
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      }),
    })
    const j = await r.json() as { ok?: boolean; description?: string }
    const username = await botUsername(token)
    if (!j.ok) return NextResponse.json({ ok: false, reason: j.description ?? 'setWebhook failed' }, { status: 500 })
    return NextResponse.json({ ok: true, webhookUrl, botUsername: username })
  } catch (e) {
    return NextResponse.json({ ok: false, reason: e instanceof Error ? e.message : 'setup failed' }, { status: 500 })
  }
}
