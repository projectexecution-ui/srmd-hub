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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderHtml(subject: string, text: string, link: string): string {
  const body = escapeHtml(text).replace(/\n/g, '<br/>')
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111827">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden">
      <tr><td style="padding:24px 28px 8px"><span style="font-weight:700;font-size:18px;color:#111827">CT&nbsp;HUB</span></td></tr>
      <tr><td style="padding:0 28px"><h1 style="font-size:18px;margin:8px 0 4px;color:#111827">${escapeHtml(subject)}</h1></td></tr>
      <tr><td style="padding:4px 28px 8px;font-size:14px;line-height:1.6;color:#4b5563">${body}</td></tr>
      <tr><td style="padding:16px 28px 28px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:10px">Open CT&nbsp;HUB</a></td></tr>
    </table>
    <p style="font-size:11px;color:#9ca3af;margin-top:12px">SRMD Construction · CT HUB</p>
  </td></tr></table></body></html>`
}

export async function POST(req: NextRequest) {
  const secret = process.env.NOTIFY_INTERNAL_SECRET
  if (!secret) return NextResponse.json({ error: 'email-not-configured' }, { status: 503 })
  if (req.headers.get('x-internal-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let payload: { to?: string; subject?: string; text?: string; url?: string | null } | null = null
  try { payload = await req.json() } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }) }

  const to = String(payload?.to ?? '').trim()
  if (!to || !to.includes('@')) return NextResponse.json({ error: 'missing-recipient' }, { status: 400 })
  const subject = String(payload?.subject ?? 'CT HUB notification').slice(0, 200)
  const text = String(payload?.text ?? '')
  const rawUrl = payload?.url ? String(payload.url) : null

  const tx = getTransport()
  if (!tx) return NextResponse.json({ error: 'email-not-configured' }, { status: 503 })

  const origin = req.nextUrl.origin
  const link = rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `${origin}${rawUrl}`) : origin
  const fromName = process.env.GMAIL_FROM_NAME || 'CT HUB'

  try {
    await tx.sendMail({
      from: `"${fromName}" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text: text + (rawUrl ? `\n\nOpen CT HUB: ${link}` : ''),
      html: renderHtml(subject, text, link),
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'send-failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
