// Mayank's daily CT-Head stuck-bills worklist email.
//   GET  (dispatcher / cron, Bearer CRON_SECRET) → build the worklist from the
//        stored stuck snapshot + the verification checklist, send to the
//        configured recipients (app_settings.bills_worklist_to). Gated by the
//        notification rule `bills_stuck_worklist` (email). Ships ON.
//   POST (admin / bills-pipeline edit) → send a test to the caller.
import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can, getMyUser } from '@/lib/auth'
import { buildStuckWorklist, type WorklistBill, type WorklistCheck } from '@/lib/bills-pipeline/stuck-worklist'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function baseUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return `https://${prod || 'ct-hub.vercel.app'}`
}
function istDateLabel(): string {
  return new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = ReturnType<typeof createServiceClient<any, any, any>>

async function loadWorklist(sb: Client) {
  const [{ data: settings }, { data: checkRows }] = await Promise.all([
    sb.from('app_settings').select('key, value').in('key', ['bills_pipeline_stuck', 'bills_pipeline_last', 'bills_worklist_to']),
    sb.from('bp_bill_checklist').select('bill_id, ms_sheet, abstract_sheet, po_wo, drawing'),
  ])
  const map = new Map((settings ?? []).map(r => [r.key as string, r.value as string]))
  let bills: WorklistBill[] = []
  try { bills = JSON.parse(map.get('bills_pipeline_stuck') ?? '[]') as WorklistBill[] } catch { /* ignore */ }
  let asOf = ''
  try { asOf = (JSON.parse(map.get('bills_pipeline_last') ?? '{}') as { asOf?: string }).asOf ?? '' } catch { /* ignore */ }
  const checks: Record<string, WorklistCheck> = {}
  for (const c of checkRows ?? []) {
    checks[c.bill_id as string] = {
      ms_sheet: !!c.ms_sheet, abstract_sheet: !!c.abstract_sheet, po_wo: !!c.po_wo, drawing: !!c.drawing,
    }
  }
  const to = (map.get('bills_worklist_to') ?? 'mayank.srmd@gmail.com')
    .split(',').map(s => s.trim()).filter(s => s.includes('@'))
  return { bills, checks, asOf, to }
}

async function sendMail(to: string, subject: string, html: string): Promise<string | null> {
  const secret = process.env.NOTIFY_INTERNAL_SECRET
  if (!secret) return 'no-internal-secret'
  try {
    const res = await fetch(`${baseUrl()}/api/email/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ to, subject, url: '/bills-pipeline', html, text: 'Your daily stuck-bills worklist — open in an HTML mail client.' }),
    })
    const j = await res.json().catch(() => ({}))
    return res.ok && j.ok !== false ? null : (j.error || `status ${res.status}`)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: rule } = await sb.from('notification_rules').select('enabled')
    .eq('scope', 'global').eq('event_type', 'bills_stuck_worklist').eq('channel', 'email').maybeSingle()
  if (!rule?.enabled) return NextResponse.json({ ok: true, skipped: 'disabled' })

  const { bills, checks, asOf, to } = await loadWorklist(sb)
  if (to.length === 0) return NextResponse.json({ ok: true, skipped: 'no-recipient' })

  const { subject, html, count } = buildStuckWorklist(bills, checks, { asOf, dateLabel: istDateLabel() })
  if (count === 0) return NextResponse.json({ ok: true, skipped: 'nothing-at-ct-head' })

  const errors: string[] = []
  for (const addr of to) { const err = await sendMail(addr, subject, html); if (err) errors.push(`${addr}: ${err}`) }
  return NextResponse.json({ ok: errors.length === 0, sent: to.length - errors.length, count, errors })
}

export async function POST() {
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-pipeline', 'edit')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const me = await getMyUser()
  if (!me?.email) return NextResponse.json({ error: 'no-email-on-your-account' }, { status: 400 })

  const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { bills, checks, asOf } = await loadWorklist(sb)
  const { subject, html, count } = buildStuckWorklist(bills, checks, { asOf, dateLabel: istDateLabel() })
  const err = await sendMail(me.email, `[TEST] ${subject}`, html)
  return NextResponse.json({ ok: !err, to: me.email, count, error: err })
}
