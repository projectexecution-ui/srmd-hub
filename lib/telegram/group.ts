// Broadcast a curated report to the shared management Telegram GROUP (when one
// is registered), on top of the per-person DMs. Only whole-portfolio report
// types are allowed here — approvals / @mentions never broadcast to a group.
// Reads the group chat id from app_settings and renders the SAME card the DM
// uses (renderCardSpec), so the group post looks identical.

import { renderCardSpec, renderReportCard, shouldRenderCard } from '@/lib/telegram/report-card'
import type { CardSpec } from '@/lib/telegram/card-spec'

// Report types allowed to broadcast to the group. Keep this tight — the group
// is a notice board, not an inbox. Add a type here to send it to the group too.
export const TELEGRAM_GROUP_BROADCAST_TYPES = new Set<string>([
  'cc_budget_vs_actual_report',
])

/* eslint-disable @typescript-eslint/no-explicit-any */
async function groupChatId(supabase: any): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings').select('value').eq('key', 'telegram_reports_group_chat_id').maybeSingle()
  const id = (data?.value ?? '').toString().trim()
  return id || null
}

export interface GroupBroadcast {
  type: string
  title: string
  body: string
  cardSpec?: CardSpec | null
  /** Full-detail text fallback (used if the image can't render). */
  cardText?: string | null
  url?: string | null
}

type SendResult = { ok: true; mode: string } | { skipped: string } | { ok: false; error: string }

/**
 * Post a report to the management group if one is registered and the type is
 * allowed. Never throws — returns a skip/ok/error result the caller can log.
 */
export async function broadcastReportToGroup(supabase: any, b: GroupBroadcast): Promise<SendResult> {
  if (!TELEGRAM_GROUP_BROADCAST_TYPES.has(b.type)) return { skipped: 'type-not-broadcast' }
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { skipped: 'no-token' }
  const chatId = await groupChatId(supabase)
  if (!chatId) return { skipped: 'no-group' }

  const dateLabel = new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric',
  })
  const origin = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')
  const rawUrl = b.url ?? null
  const link = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `${origin}${rawUrl}`) : (origin || undefined)
  const openButton = link ? { inline_keyboard: [[{ text: 'Open in CT Hub', url: link }]] } : undefined

  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  async function sendPhoto(png: Buffer): Promise<SendResult> {
    const form = new FormData()
    form.append('chat_id', chatId!)
    form.append('caption', b.title.slice(0, 1000))
    if (openButton) form.append('reply_markup', JSON.stringify(openButton))
    form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'report.png')
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form })
    const j = (await resp.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    return j.ok ? { ok: true, mode: 'card' } : { ok: false, error: j.description || 'sendPhoto failed' }
  }
  async function sendText(): Promise<SendResult> {
    const text = `<b>${esc(b.title)}</b>${b.cardText ? '\n' + esc(b.cardText) : b.body ? '\n' + esc(b.body) : ''}`.slice(0, 4000)
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: openButton }),
    })
    const j = (await resp.json().catch(() => ({}))) as { ok?: boolean; description?: string }
    return j.ok ? { ok: true, mode: 'text' } : { ok: false, error: j.description || 'sendMessage failed' }
  }

  try {
    if (b.cardSpec) {
      try { return await sendPhoto(await renderCardSpec({ ...b.cardSpec, dateLabel: b.cardSpec.dateLabel ?? dateLabel })) }
      catch { /* fall through to simple card / text */ }
    }
    if (b.cardSpec || shouldRenderCard(b.type)) {
      try { return await sendPhoto(await renderReportCard({ title: b.title, body: b.cardText || b.body, dateLabel })) }
      catch { return await sendText() }
    }
    return await sendText()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'group-send-failed' }
  }
}
