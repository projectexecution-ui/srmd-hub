import type { SupabaseClient } from '@supabase/supabase-js'
import { buildInFlight, type FlightCert, type FlightEvent, type InFlight } from './in-flight'
import { loadOutOfScope, rowOutOfScope } from './scope'

/** One project's share of Bills Approval.
 *
 *  Aksha, 14 Sep 2026: "For Now build in One Project like NGH B that also for
 *  Admin with all ur Flows which u are recomending — as this module is new for
 *  everyone and i need to check within us more deeply before releasing."
 *
 *  Everything here is the org-level screen narrowed to one building, using the
 *  same pure builders, so the project tab and the section can never quote
 *  different money for the same bill. Nothing is re-derived.
 *
 *  The narrowing is on IN4 SUB-PROJECTS, not on the CT Hub project id: a CT Hub
 *  project can cover more than one of them (Execution and Interior Scope), and
 *  the certificates only ever carry the sub-project. */

export interface ProjectBills {
  /** The IN4 sub-projects this CT Hub project covers. */
  subprojectIds: number[]
  subprojectNames: string[]
  inFlight: InFlight
  /** Certificates with money still owed, whatever desk they sit at. */
  waiting: { bills: number; outstanding: number; oldestDays: number }
  /** Work orders on this project, and what is left to bill against them. */
  orders: { count: number; ordered: number; billed: number; retentionHeld: number }
  /** Bills entered in CT Hub against this project — the write side. */
  entered: Array<{
    id: string; vendor: string; billNo: string | null; stage: string
    amount: number; billDate: string | null; woNo: string | null
  }>
}

const DEAD = new Set(['cancelled', 'reversed'])
const live = (s: string | null | undefined) => !DEAD.has((s ?? '').trim().toLowerCase())

/** Every IN4 sub-project that books against this CT Hub project — through
 *  IN4's own link chain, plus any Bills Approval project pointed at it by
 *  hand. */
export async function subprojectsFor(sb: SupabaseClient, ccProjectId: string): Promise<number[]> {
  const ids = new Set<number>()

  const { data: bph } = await sb.from('cc_bph_project_links')
    .select('bph_project_id').eq('cc_project_id', ccProjectId)
  const keys = (bph ?? []).map(r => r.bph_project_id as string).filter(Boolean)
  if (keys.length) {
    const { data: links } = await sb.from('in4_subproject_links')
      .select('subproject_id, bph_project_id').in('bph_project_id', keys)
    for (const l of links ?? []) ids.add(l.subproject_id as number)
  }

  const { data: desks } = await sb.from('bb_project_desks')
    .select('subproject_id').eq('cc_project_id', ccProjectId)
  for (const d of desks ?? []) ids.add(d.subproject_id as number)

  return [...ids]
}

const daysSince = (iso: string | null, now: number): number => {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : 0
}

export async function loadProjectBills(
  sb: SupabaseClient, ccProjectId: string, now = Date.now(),
): Promise<ProjectBills> {
  const subprojectIds = await subprojectsFor(sb, ccProjectId)

  const empty: ProjectBills = {
    subprojectIds, subprojectNames: [],
    inFlight: { rows: [], byStatus: [], totals: { bills: 0, outstanding: 0 }, haveTrail: false },
    waiting: { bills: 0, outstanding: 0, oldestDays: 0 },
    orders: { count: 0, ordered: 0, billed: 0, retentionHeld: 0 },
    entered: [],
  }
  if (!subprojectIds.length) return empty

  const excluded = await loadOutOfScope(sb)
  const inScope = subprojectIds.filter(id => !rowOutOfScope(excluded, id))
  if (!inScope.length) return empty

  const [{ data: names }, { data: certData }, { data: woData }, { data: billData }] = await Promise.all([
    sb.from('in4_subprojects').select('id, name').in('id', inScope),
    sb.from('in4_wo_certificates')
      .select('certificate_id, kind, display_no, invoice_no, wo_no, contractor_name, project_id, subproject_id, status_name, outstanding_amt, creation_dt')
      .in('subproject_id', inScope),
    sb.from('in4_work_orders')
      .select('wo_id, display_no, wo_gross_value, wo_paid_amt, wo_retention_amt, subproject_id')
      .in('subproject_id', inScope),
    sb.from('bb_bills')
      .select('id, bill_no, bill_date, order_no, claimed_amount, net_amount, current_stage, vendor_text, in4_subproject_id, project_id')
      .or(`project_id.eq.${ccProjectId},in4_subproject_id.in.(${inScope.join(',')})`),
  ])

  const certs = (certData ?? []) as FlightCert[]

  // Only the trail for the certificates on screen. The mirror is ~16,000
  // movements and all but a handful belong to bills that are long paid.
  let events: FlightEvent[] = []
  if (certs.length) {
    const { data } = await sb.from('in4_cert_events')
      .select('certificate_id, at, status_name, actor_name, remark')
      .in('certificate_id', certs.map(c => c.certificate_id))
    events = (data ?? []) as FlightEvent[]
  }

  const owed = certs.filter(c => live(c.status_name) && Number(c.outstanding_amt || 0) > 0)
  const wos = (woData ?? []) as Array<{ display_no: string | null; wo_gross_value: number | null; wo_paid_amt: number | null; wo_retention_amt: number | null }>
  const numbered = wos.filter(w => w.display_no)


  return {
    subprojectIds: inScope,
    subprojectNames: (names ?? []).map(n => (n.name as string) ?? '').filter(Boolean),
    inFlight: buildInFlight(certs, events, now),
    waiting: {
      bills: owed.length,
      outstanding: owed.reduce((s, c) => s + Number(c.outstanding_amt || 0), 0),
      oldestDays: owed.reduce((m, c) => Math.max(m, daysSince(c.creation_dt, now)), 0),
    },
    orders: {
      count: numbered.length,
      ordered: numbered.reduce((s, w) => s + Number(w.wo_gross_value || 0), 0),
      billed: numbered.reduce((s, w) => s + Number(w.wo_paid_amt || 0), 0),
      retentionHeld: numbered.reduce((s, w) => s + Number(w.wo_retention_amt || 0), 0),
    },
    entered: (billData ?? []).map(b => ({
      id: b.id as string,
      vendor: (b.vendor_text as string | null) || '—',
      billNo: b.bill_no as string | null,
      stage: b.current_stage as string,
      amount: Number((b.net_amount ?? b.claimed_amount) || 0),
      billDate: b.bill_date as string | null,
      woNo: b.order_no as string | null,
    })),
  }
}
