// Daily inventory movement report → management email.
//
//   GET  (cron dispatcher, Bearer CRON_SECRET) → if the "daily report" setting
//        is on, email yesterday's Entry / Exit / Transfer summary to every admin
//        plus any extra recipients configured in Inventory → Settings.
//   POST (admin, from Settings "Send me a test") → same report, to the caller.
//
// Reuses the shared bucketing + HTML from lib/inventory/daily-movement and the
// /api/email/send mailer (Gmail-via-DB) like the other digests.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'
import { istDateStr, istShiftDate, istDayRange } from '@/lib/inventory/day-window'
import { bucketMovements, renderDailyEmailHtml } from '@/lib/inventory/daily-movement'
import { fetchDayRawMovements } from '@/lib/inventory/fetch-movements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

function baseUrl(): string {
  return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'ct-hub.vercel.app'}`
}

async function buildYesterday(supabase: Client) {
  const date = istShiftDate(istDateStr(), -1)
  const { label } = istDayRange(date)
  const { rows } = await fetchDayRawMovements(supabase, date)
  const report = bucketMovements(rows)
  const html = renderDailyEmailHtml(report, label, { url: `${baseUrl()}/inventory/reports/daily?date=${date}` })
  const moved = report.entries.length + report.exits.length + report.transfers.length + report.adjustments.length
  return { report, html, label, date, moved }
}

async function sendTo(to: string, subject: string, html: string): Promise<string | null> {
  const secret = process.env.NOTIFY_INTERNAL_SECRET
  if (!secret) return 'no-internal-secret'
  try {
    const res = await fetch(`${baseUrl()}/api/email/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ to, subject, url: '/inventory/reports/daily', html, text: 'Daily inventory movement — open in an HTML mail client.' }),
    })
    const j = await res.json().catch(() => ({}))
    return res.ok && j.ok !== false ? null : (j.error || `status ${res.status}`)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })
  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } })

  const { data: settings } = await supabase.from('app_settings').select('key, value')
    .in('key', ['inv_daily_report', 'inv_daily_report_emails'])
  const map = new Map((settings ?? []).map(r => [r.key as string, (r.value as string) ?? '']))
  const on = ['true', '1', 'on'].includes((map.get('inv_daily_report') ?? '').trim())
  if (!on) return NextResponse.json({ ok: true, skipped: 'daily_report off' })

  const { data: admins } = await supabase.from('profiles').select('email').eq('role', 'admin').eq('is_active', true)
  const extra = (map.get('inv_daily_report_emails') ?? '').split(/[,;\s]+/).map(s => s.trim()).filter(s => s.includes('@'))
  const recipients = [...new Set([...(admins ?? []).map(a => (a.email as string) || '').filter(Boolean), ...extra])]
  if (recipients.length === 0) return NextResponse.json({ ok: true, skipped: 'no-recipients' })

  const { html, label, moved } = await buildYesterday(supabase)
  const subject = `Inventory — daily movement · ${label}`
  const results = await Promise.all(recipients.map(async to => ({ to, err: await sendTo(to, subject, html) })))
  const sent = results.filter(r => !r.err).map(r => r.to)
  const failed = results.filter(r => r.err)
  return NextResponse.json({ ok: true, moved, sent: sent.length, recipients: recipients.length, failed })
}

export async function POST() {
  const session = await createClient()
  const perms = await getMyPermissions()
  if (!can(perms, 'inventory', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Not allowed' }, { status: 403 })
  }
  const { data: { user } } = await session.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, reason: 'No session' }, { status: 401 })
  const { data: prof } = await session.from('profiles').select('email').eq('id', user.id).maybeSingle()
  const email = (prof?.email as string) || ''
  if (!email) return NextResponse.json({ ok: false, reason: 'Your profile has no email.' })

  const { html, label } = await buildYesterday(session as unknown as Client)
  const err = await sendTo(email, `Inventory — daily movement · ${label} (test)`, html)
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 500 })
  return NextResponse.json({ ok: true, sent: 1, to: 'you' })
}
