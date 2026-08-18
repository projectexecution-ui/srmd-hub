// Telegram bot webhook. Telegram POSTs updates here after the bot is set up
// (see /api/telegram/setup). We only care about two commands:
//   /start <code>  — bind this chat to the CT Hub user who owns <code>
//   /stop          — turn Telegram alerts off for this chat
// Verified by the secret token Telegram echoes back (set at setWebhook time to
// NOTIFY_INTERNAL_SECRET). Always answer 200 so Telegram doesn't retry-storm.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { handleApprovalCallback, handleApprovalAmountReply } from '@/lib/telegram/cc-approval-webhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function reply(token: string, chatId: string | number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    })
  } catch { /* best-effort reply */ }
}

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFY_INTERNAL_SECRET
  const token = process.env.TELEGRAM_BOT_TOKEN
  // Ack (200) even when unconfigured so Telegram doesn't hammer the endpoint.
  if (!secret || !token) return NextResponse.json({ ok: true })
  if (req.headers.get('x-telegram-bot-api-secret-token') !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let update: {
    message?: {
      text?: string
      chat?: { id?: number | string; type?: string; title?: string }
      from?: { id?: number | string }
    }
    callback_query?: {
      id: string
      data?: string
      from?: { id?: number | string }
      message?: { message_id?: number; chat?: { id?: number | string } }
    }
  } | null = null
  try { update = await req.json() } catch { return NextResponse.json({ ok: true }) }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const svc = url && key ? createServiceClient(url, key, { auth: { persistSession: false } }) : null

  // ── Inline-button taps (budget approvals) arrive as callback_query, not a
  //     message. Handle + ack them before the message path. ──
  const cbq = update?.callback_query
  if (cbq) {
    if (svc) { try { await handleApprovalCallback(svc, token, cbq) } catch { /* always ack 200 */ } }
    return NextResponse.json({ ok: true })
  }

  const msg = update?.message
  const chatId = msg?.chat?.id
  const chatType = msg?.chat?.type ?? 'private'
  const chatTitle = msg?.chat?.title ?? ''
  const fromId = msg?.from?.id
  const text = (msg?.text ?? '').trim()
  if (chatId == null || !text) return NextResponse.json({ ok: true })

  const connectHint = 'Open CT Hub → Settings → Notifications → Connect Telegram to link your account.'

  // ── Group chat: register/unregister this group as the reports channel. The
  //     bot must be a group admin to receive these commands. Authorised by the
  //     sender's Telegram id (only management can link Telegram). ──
  if (chatType === 'group' || chatType === 'supergroup') {
    if (text.startsWith('/reportshere')) {
      if (!svc || fromId == null) { await reply(token, chatId, 'Setup is incomplete — please try again shortly.'); return NextResponse.json({ ok: true }) }
      const { data: who, error } = await svc.rpc('telegram_register_reports_group', {
        p_chat_id: String(chatId), p_title: chatTitle, p_from_id: String(fromId),
      })
      if (error || !who) {
        await reply(token, chatId, 'Only a CT Hub management member who has connected Telegram can set this up. Connect your own account first (CT Hub → Settings → Notifications), then type /reportshere here again.')
      } else {
        await reply(token, chatId, `✅ Done — this group will now receive CT Hub broadcast reports (like the weekly Budget vs Actual card). Set up by ${who}. Type /stop here to turn it off.`)
      }
      return NextResponse.json({ ok: true })
    }
    if (text.startsWith('/stop')) {
      if (svc && fromId != null) {
        const { data: done } = await svc.rpc('telegram_unregister_reports_group_by_chat', {
          p_chat_id: String(chatId), p_from_id: String(fromId),
        })
        if (done) await reply(token, chatId, 'Turned off — this group will no longer receive CT Hub reports.')
      }
      return NextResponse.json({ ok: true })
    }
    // Ignore ordinary group chatter silently — never spam the group.
    return NextResponse.json({ ok: true })
  }

  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1] ?? ''
    if (!code) { await reply(token, chatId, connectHint); return NextResponse.json({ ok: true }) }
    if (!svc) { await reply(token, chatId, 'Setup is incomplete — please try again shortly.'); return NextResponse.json({ ok: true }) }
    const { data: name, error } = await svc.rpc('telegram_link_confirm', {
      p_code: code, p_chat_id: String(chatId),
    })
    if (error || !name) {
      await reply(token, chatId, 'That link has expired or is invalid. Generate a fresh one from CT Hub → Settings → Notifications.')
    } else {
      await reply(token, chatId, `✅ Connected, ${name}! You'll get your CT Hub reports here. Send /stop anytime to turn them off.`)
    }
    return NextResponse.json({ ok: true })
  }

  if (text.startsWith('/stop')) {
    if (svc) await svc.rpc('telegram_unlink_by_chat', { p_chat_id: String(chatId) })
    await reply(token, chatId, 'Turned off — you won\'t get CT Hub reports here anymore. Reconnect anytime from CT Hub → Settings → Notifications.')
    return NextResponse.json({ ok: true })
  }

  // A plain reply may be the typed checked-amount answering an "Approve" tap.
  if (svc && fromId != null) {
    try {
      const consumed = await handleApprovalAmountReply(svc, token, chatId, fromId, text)
      if (consumed) return NextResponse.json({ ok: true })
    } catch { /* fall through to the generic hint */ }
  }

  await reply(token, chatId, `CT Hub bot. ${connectHint}`)
  return NextResponse.json({ ok: true })
}
