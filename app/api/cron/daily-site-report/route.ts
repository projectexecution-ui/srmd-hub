// Daily "material arrived" digest to each Atm Head by email.
//
//   GET  (Vercel cron, Bearer CRON_SECRET) → email each Atm Head their sites'
//        material arrivals for today. SHIPS OFF — gated on the
//        `daily_site_report_digest` email notification rule; nothing is sent
//        (not even an in-app row) until that rule is enabled.
//   POST (management, daily-site-report edit) → dry-run PREVIEW of today's
//        digest for the caller's scope (no email sent) so the format can be
//        eyeballed before turning the rule on.
//
// Recipients + per-head project scope come from cc_project_approvers (role
// 'head') — the same Atm→projects roster the Internal Estimate uses. Delivery
// rides the native Gmail queue via notify_user().

import { NextResponse } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, getMyProfile, getMyUser, can } from '@/lib/auth'
import { deriveStage } from '@/lib/daily-site-report/stages'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IST = 5.5 * 3600 * 1000
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

type ArrivalRow = {
  project_id: string
  supplier_name_text: string | null
  material_description: string
  quantity: number | string | null
  unit: string | null
  amount: number | string | null
  bill_submitted_to_ct: boolean
  payment_started: boolean
  grn_done: boolean
  paid: boolean
  projects: { code: string | null; name: string | null } | { code: string | null; name: string | null }[] | null
  vendors: { name: string | null } | { name: string | null }[] | null
}

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}
function humanDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
}
function rupees(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_00_00_000) return '₹' + (n / 1_00_00_000).toFixed(2) + ' Cr'
  if (a >= 1_00_000) return '₹' + (n / 1_00_000).toFixed(1).replace(/\.0$/, '') + ' L'
  return '₹' + Math.round(n).toLocaleString('en-IN')
}
function toArrival(r: ArrivalRow) {
  const proj = unwrap(r.projects)
  const vend = unwrap(r.vendors)
  const stage = deriveStage({
    bill_submitted_to_ct: !!r.bill_submitted_to_ct,
    payment_started: !!r.payment_started,
    grn_done: !!r.grn_done,
    paid: !!r.paid,
  })
  return {
    projectId: r.project_id,
    site: proj?.code || proj?.name || '—',
    supplier: vend?.name || r.supplier_name_text || '—',
    material: r.material_description,
    qty: r.quantity != null ? `${r.quantity}${r.unit ? ' ' + r.unit : ''}` : (r.unit || ''),
    amount: r.amount != null ? Number(r.amount) : null,
    stage: stage.label,
  }
}
type Arrival = ReturnType<typeof toArrival>

function buildText(rows: Arrival[], dateHuman: string): string {
  const total = rows.reduce((s, r) => s + (r.amount ?? 0), 0)
  const lines = rows.map(r =>
    `• [${r.site}] ${r.supplier} — ${r.material}${r.qty ? ' (' + r.qty + ')' : ''}${r.amount != null ? ' — ' + rupees(r.amount) : ''} — ${r.stage}`)
  return `Material arrived on ${dateHuman}\n\n${lines.join('\n')}\n\n${rows.length} ${rows.length === 1 ? 'delivery' : 'deliveries'} · ${rupees(total)} total`
}
function subjectLine(rows: Arrival[], dateHuman: string): string {
  return `Daily site report — ${rows.length} material ${rows.length === 1 ? 'delivery' : 'deliveries'} (${dateHuman})`
}

async function loadArrivals(supabase: Client, date: string): Promise<Arrival[]> {
  const { data } = await supabase
    .from('dsr_reports')
    .select('project_id, supplier_name_text, material_description, quantity, unit, amount, bill_submitted_to_ct, payment_started, grn_done, paid, projects ( code, name ), vendors ( name )')
    .eq('received_on', date)
    .order('project_id')
  return ((data ?? []) as unknown as ArrivalRow[]).map(toArrival)
}

// ── GET: the daily cron ──────────────────────────────────────────────────
export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })
  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } })

  // On/off switch. Gate here so nothing (not even an in-app row) is created
  // while the digest is off.
  const { data: rule } = await supabase
    .from('notification_rules')
    .select('enabled')
    .eq('scope', 'global').eq('event_type', 'daily_site_report_digest').eq('channel', 'email')
    .maybeSingle()
  if (!rule?.enabled) return NextResponse.json({ ok: true, skipped: 'disabled' })

  const date = new Date(Date.now() + IST).toISOString().slice(0, 10)
  const dateHuman = humanDate(date)
  const arrivals = await loadArrivals(supabase, date)
  if (arrivals.length === 0) return NextResponse.json({ ok: true, skipped: 'no-arrivals', date })

  const { data: appr } = await supabase.from('cc_project_approvers').select('user_id, project_id').eq('role', 'head')
  const byHead = new Map<string, Set<string>>()
  for (const a of (appr ?? []) as Array<{ user_id: string; project_id: string }>) {
    const set = byHead.get(a.user_id) ?? new Set<string>()
    set.add(a.project_id)
    byHead.set(a.user_id, set)
  }

  let sent = 0
  const detail: Array<{ uid: string; sent?: boolean; skipped?: string; error?: string }> = []
  for (const [uid, projectSet] of byHead) {
    const mine = arrivals.filter(a => projectSet.has(a.projectId))
    if (mine.length === 0) { detail.push({ uid, skipped: 'no-arrivals' }); continue }
    const { error } = await supabase.rpc('notify_user', {
      p_user_id: uid,
      p_type: 'daily_site_report_digest',
      p_title: subjectLine(mine, dateHuman),
      p_body: buildText(mine, dateHuman),
      p_url: '/daily-site-report',
      p_module_slug: 'daily-site-report',
      p_data: { date, count: mine.length, rows: mine },
    })
    if (error) detail.push({ uid, error: error.message })
    else { sent++; detail.push({ uid, sent: true }) }
  }
  return NextResponse.json({ ok: true, date, heads: byHead.size, sent, detail })
}

// ── POST: dry-run preview (no email sent) ────────────────────────────────
export async function POST() {
  const [perms, profile, user] = await Promise.all([getMyPermissions(), getMyProfile(), getMyUser()])
  const role = profile?.role
  const isMgmt = role === 'admin' || role === 'project_head' || role === 'head' || role === 'founder'
  if (!can(perms, 'daily-site-report', 'edit') || !isMgmt || !user) {
    return NextResponse.json({ ok: false, reason: 'Not allowed' }, { status: 403 })
  }
  const supabase = (await createClient()) as unknown as Client
  const date = new Date(Date.now() + IST).toISOString().slice(0, 10)
  const dateHuman = humanDate(date)
  let arrivals = await loadArrivals(supabase, date)

  if (role === 'head' || role === 'project_head') {
    const { data: appr } = await supabase.from('cc_project_approvers').select('project_id').eq('user_id', user.id).eq('role', 'head')
    const mine = new Set((appr ?? []).map((r: { project_id: string }) => r.project_id))
    arrivals = arrivals.filter(a => mine.has(a.projectId))
  }

  return NextResponse.json({
    ok: true,
    preview: true,
    date,
    count: arrivals.length,
    subject: subjectLine(arrivals, dateHuman),
    body: buildText(arrivals, dateHuman),
    note: 'Preview only — no email sent. Enable the daily_site_report_digest email rule to start sending.',
  })
}
