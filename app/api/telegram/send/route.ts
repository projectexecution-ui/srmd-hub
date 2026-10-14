// Telegram sender. The database (dispatch_telegram_delivery trigger via pg_net)
// POSTs one queued telegram delivery here; we relay it to the Telegram Bot API.
//
// Two shapes (Aksha's picks, 14 Oct 2026):
//   · TEXT CARD — the six-part frame from lib/telegram/compose.ts (why you got
//     it · the fact · the figure · what next · who and when · buttons), built
//     from the notification's structured data. Every quick alert.
//   · PICTURE CARD — reports with a card_spec (Indent → PO) and the digest
//     types, rendered to PNG (sendPhoto) so they forward cleanly to WhatsApp.
// Both carry the ✓ Seen button (marks the notice read in CT Hub) beside the
// one place to open. Authenticated by the same shared secret as email/push
// (NOTIFY_INTERNAL_SECRET), so the public route can't be abused.
//
// Required env (Vercel → Settings → Environment Variables):
//   TELEGRAM_BOT_TOKEN       the bot token from @BotFather (secret)
//   NOTIFY_INTERNAL_SECRET   long random string; must match the DB copy
//   SUPABASE_SERVICE_ROLE_KEY to write the delivery outcome back + read the recipient's role
//   NEXT_PUBLIC_APP_URL      canonical app origin for the "Open" button link

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { renderReportCard, renderCardSpec, shouldRenderCard } from '@/lib/telegram/report-card'
import { composeTelegram, cardKeyboard, prefersText, type TelegramNotice } from '@/lib/telegram/compose'
import type { CardSpec } from '@/lib/telegram/card-spec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  try { return createServiceClient(url, key, { auth: { persistSession: false } }) } catch { return null }
}

// Write the TRUE delivery outcome back (like email/push): 'sent' means Telegram
// accepted it; 'skipped' means the chat is gone/blocked (retry won't help);
// 'failed' is a transient error worth a retry. Best-effort — a write-back miss
// just leaves the row for the sweep.
async function markDelivery(svc: SupabaseClient | null, deliveryId: string, status: 'sent' | 'failed' | 'skipped', error?: string) {
  if (!svc || !deliveryId) return
  try {
    await svc.from('notification_deliveries').update(
      status === 'sent'
        ? { status: 'sent', sent_at: new Date().toISOString(), error: null }
        : { status, error: (error ?? 'send-failed').slice(0, 300) },
    ).eq('id', deliveryId)
  } catch { /* best-effort — the sweep is the backstop */ }
}

/** The recipient's role, for the "Needs you · Atm Head" line. Best-effort. */
async function roleOf(svc: SupabaseClient | null, userId: string): Promise<string | null> {
  if (!svc || !userId) return null
  try {
    const { data } = await svc.from('profiles').select('role').eq('id', userId).maybeSingle()
    return (data?.role as string | null) ?? null
  } catch { return null }
}

// Permanent failures (chat gone / bot blocked) → skip so the sweep stops.
function isPermanent(desc: string): boolean {
  return /chat not found|bot was blocked|user is deactivated|deactivated|kicked|group chat was upgraded/i.test(desc)
}

const OPEN_LABEL: Record<string, string> = {
  procurement_digest: 'Open the tracker',
  cc_budget_approved_digest: 'Open approvals',
  cc_engineer_digest: 'Open Cost Control',
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
    type?: string | null
    // Full-detail text (report generators put the complete, project-grouped
    // breakdown here so the image carries the same detail as the email).
    cardText?: string | null
    // A structured spec that renders a rich card mirroring the HTML email.
    cardSpec?: CardSpec | null
    deliveryId?: string | null
    // The notification row itself, for the text card and the ✓ Seen button.
    notificationId?: string | null
    userId?: string | null
    docTable?: string | null
    data?: Record<string, unknown> | null
  } | null = null
  try { payload = await req.json() } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }) }
  const svc = serviceClient()
  const deliveryId = payload?.deliveryId ? String(payload.deliveryId) : ''

  const chatId = payload?.chatId != null ? String(payload.chatId).trim() : ''
  if (!chatId) {
    await markDelivery(svc, deliveryId, 'skipped', 'no chat id')
    return NextResponse.json({ error: 'missing-chat' }, { status: 400 })
  }

  const type = payload?.type ?? null
  const title = String(payload?.title ?? 'CT HUB').slice(0, 300)
  const body = String(payload?.text ?? '').slice(0, 3500)
  const cardText = payload?.cardText ? String(payload.cardText).slice(0, 6000) : ''
  // Reports carry the full breakdown in cardText; quick alerts have only body.
  const effectiveBody = cardText.trim() ? cardText : body
  const rawUrl = payload?.url ? String(payload.url) : null
  const origin = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  const link = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `${origin}${rawUrl}`) : origin
  const notificationId = payload?.notificationId ? String(payload.notificationId) : null
  const role = await roleOf(svc, payload?.userId ? String(payload.userId) : '')

  const notice: TelegramNotice = {
    id: notificationId, type, title, body, url: link, role,
    data: payload?.data && typeof payload.data === 'object' ? payload.data : null,
  }
  const photoKeyboard = { inline_keyboard: cardKeyboard(notice, OPEN_LABEL[(type ?? '').toLowerCase()] ?? 'Open in CT Hub') }

  async function finish(j: { ok?: boolean; description?: string }, mode: string, fallbackDesc: string): Promise<NextResponse> {
    if (j.ok) { await markDelivery(svc, deliveryId, 'sent'); return NextResponse.json({ ok: true, mode }) }
    const desc = j.description || fallbackDesc
    const perm = isPermanent(desc)
    await markDelivery(svc, deliveryId, perm ? 'skipped' : 'failed', desc)
    return NextResponse.json({ error: desc }, { status: perm ? 200 : 500 })
  }

  // ── Text card (quick alerts + the fallback if a picture can't render) ──
  async function sendText(): Promise<NextResponse> {
    const composed = composeTelegram(notice)
    try {
      const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId, text: composed.html.slice(0, 4000), parse_mode: 'HTML',
          disable_web_page_preview: true, reply_markup: { inline_keyboard: composed.keyboard },
        }),
      })
      const j = await resp.json().catch(() => ({})) as { ok?: boolean; description?: string }
      return await finish(j, 'text', 'telegram send failed')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'send-failed'
      await markDelivery(svc, deliveryId, 'failed', msg)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // ── Upload a rendered PNG as a photo (falls back to text on a soft error) ──
  async function sendPhoto(png: Buffer): Promise<NextResponse> {
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption', title.slice(0, 1000))
    form.append('reply_markup', JSON.stringify(photoKeyboard))
    form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'report.png')
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form })
    const j = await resp.json().catch(() => ({})) as { ok?: boolean; description?: string }
    if (j.ok) { await markDelivery(svc, deliveryId, 'sent'); return NextResponse.json({ ok: true, mode: 'card' }) }
    const desc = j.description || 'telegram sendPhoto failed'
    if (isPermanent(desc)) { await markDelivery(svc, deliveryId, 'skipped', desc); return NextResponse.json({ error: desc }, { status: 200 }) }
    return await sendText()
  }

  const dateLabel = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  })

  // ── Rich picture card — the report generator provided a card_spec (mirrors
  //     the email). Falls back to the simple card / text if rendering fails. ──
  if (payload?.cardSpec) {
    try { return await sendPhoto(await renderCardSpec({ ...payload.cardSpec, dateLabel: payload.cardSpec.dateLabel ?? dateLabel })) }
    catch { /* fall through to the simple card / text */ }
  }

  // ── Simple picture card (a report/digest by type, without a spec) — unless
  //     the picks say this type reads better as text (the daily reminder). ──
  if ((payload?.cardSpec || shouldRenderCard(type)) && !prefersText(type)) {
    try { return await sendPhoto(await renderReportCard({ title, body: effectiveBody, dateLabel })) }
    catch { return await sendText() }
  }

  return await sendText()
}
