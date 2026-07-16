// Gmail-backed email sender. The database (dispatch_email_delivery trigger via
// pg_net) POSTs one queued notification here; we relay it to Gmail over SMTP
// using nodemailer — no third-party email service. Authenticated by a shared
// secret (NOTIFY_INTERNAL_SECRET) that lives only in Vercel env + a private DB
// table, so the public route can't be abused to send mail.
//
// Required env (Vercel → Settings → Environment Variables):
//   GMAIL_USER          the Gmail / Workspace address that sends
//   GMAIL_APP_PASSWORD  a 16-char Google App Password (NOT the login password)
//   NOTIFY_INTERNAL_SECRET  long random string; must match the DB copy
//   GMAIL_FROM_NAME     (optional) display name, defaults to "CT HUB"

import { NextRequest, NextResponse } from 'next/server'
import nodemailer, { type Transporter } from 'nodemailer'
import { renderNotificationEmail, kindFromType, type NotificationKind } from '@/lib/notifications/email-templates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let cached: Transporter | null = null
function getTransport(): Transporter | null {
  if (cached) return cached
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) return null
  cached = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
  return cached
}

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFY_INTERNAL_SECRET
  if (!secret) return NextResponse.json({ error: 'email-not-configured' }, { status: 503 })
  if (req.headers.get('x-internal-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: {
    to?: string; subject?: string; text?: string; url?: string | null
    // Rich-template extras (optional; absent → generic card, all other modules unchanged).
    type?: string | null
    data?: Record<string, unknown> | null
  } | null = null
  try { payload = await req.json() } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }) }

  const to = String(payload?.to ?? '').trim()
  if (!to || !to.includes('@')) return NextResponse.json({ error: 'missing-recipient' }, { status: 400 })
  const subject = String(payload?.subject ?? 'CT HUB notification').slice(0, 200)
  const text = String(payload?.text ?? '')
  const rawUrl = payload?.url ? String(payload.url) : null

  const tx = getTransport()
  if (!tx) return NextResponse.json({ error: 'email-not-configured' }, { status: 503 })

  // Always build links off the canonical public app URL so they open the real
  // site / installed PWA (not a Vercel preview host the cron happened to hit).
  const origin = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  const link = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `${origin}${rawUrl}`) : origin
  const fromName = process.env.GMAIL_FROM_NAME || 'CT HUB'

  const kind: NotificationKind = kindFromType(payload?.type)
  const html = renderNotificationEmail({ kind, subject, text, link, data: payload?.data ?? null })

  try {
    await tx.sendMail({
      from: `"${fromName}" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text: text + (rawUrl ? `\n\nOpen CT HUB: ${link}` : ''),
      html,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'send-failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
