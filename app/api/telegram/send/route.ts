// Telegram sender. The database (dispatch_telegram_delivery trigger via pg_net)
// POSTs one queued telegram delivery here; we relay it to the Telegram Bot API's
// sendMessage. Authenticated by the same shared secret as email/push
// (NOTIFY_INTERNAL_SECRET), so the public route can't be abused.
//
// Required env (Vercel → Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN       the bot token from @BotFather (secret)
//   NOTIFY_INTERNAL_SECRET   long random string; must match the DB copy
//   SUPABASE_SERVICE_ROLE_KEY to write the delivery outcome back
//   NEXT_PUBLIC_APP_URL      canonical app origin for the "Open" button link

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Write the TRUE delivery outcome back (like email/push): 'sent' means Telegram
// accepted it; 'skipped' means the chat is gone/blocked (retry won't help);
// 'failed' is a transient error worth a retry. Best-effort — a write-back miss
// just leaves the row for the sweep.
async function markDelivery(deliveryId: string, status: 'sent' | 'failed' | 'skipped', error?: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key || !deliveryId) return
  try {
    const svc = createServiceClient(url, key, { auth: { persistSession: false } })
    await svc.from('notification_deliveries').update(
      status === 'sent'
        ? { status: 'sent', sent_at: new Date().toISOString(), error: null }
        : { status, error: (error ?? 'send-failed').slice(0, 300) },
    ).eq('id', deliveryId)
  } catch { /* best-effort — the sweep is the backstop */ }
}

// Telegram HTML parse_mode needs &, <, > escaped in the dynamic parts.
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFY_INTERNAL_SECRET
  if (!secret) return NextResponse.json({ error: 'not-configured' }, { status: 503 })
  if (req.headers.get('x-internal-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return NextResponse.json({ error: 'telegram-not-configured' }, { status: 503 })

  let payload: {
    chatId?: string | number
    title?: string
    text?: string
    url?: string | null
    deliveryId?: string | null
  } | null = null
  try { payload = await req.json() } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }) }
  const deliveryId = payload?.deliveryId ? String(payload.deliveryId) : ''

  const chatId = payload?.chatId != null ? String(payload.chatId).trim() : ''
  if (!chatId) {
    await markDelivery(deliveryId, 'skipped', 'no chat id')
    return NextResponse.json({ error: 'missing-chat' }, { status: 400 })
  }

  const title = String(payload?.title ?? 'CT HUB').slice(0, 200)
  const text = String(payload?.text ?? '').slice(0, 3500)
  const rawUrl = payload?.url ? String(payload.url) : null
  const origin = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  const link = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `${origin}${rawUrl}`) : origin

  // Bold title, then the body. An inline "Open in CT Hub" button carries the
  // deep-link so the message text stays clean.
  const messageHtml = `<b>${esc(title)}</b>${text ? `\n${esc(text)}` : ''}`

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: 'Open in CT Hub', url: link }]] },
      }),
    })
    const j = await resp.json().catch(() => ({})) as { ok?: boolean; description?: string }
    if (j.ok) {
      await markDelivery(deliveryId, 'sent')
      return NextResponse.json({ ok: true })
    }
    // Permanent failures (chat gone / bot blocked) → skip so the sweep stops.
    const desc = j.description || 'telegram send failed'
    const permanent = /chat not found|bot was blocked|user is deactivated|deactivated|kicked|group chat was upgraded/i.test(desc)
    await markDelivery(deliveryId, permanent ? 'skipped' : 'failed', desc)
    return NextResponse.json({ error: desc }, { status: permanent ? 200 : 500 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'send-failed'
    await markDelivery(deliveryId, 'failed', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
