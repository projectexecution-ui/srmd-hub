import type { SupabaseClient } from '@supabase/supabase-js'
import { trustOf } from './daily'
import { loadOutOfScope, rowOutOfScope } from './scope'

/** The work orders you can bill against, assembled from IN4 so the entry form
 *  stops being a page of blank boxes.
 *
 *  Picking a project should narrow the work orders. Picking a work order should
 *  fill the contractor, the ordered value, what has already been billed, the
 *  trust and the next RA number — because IN4 knows every one of those and
 *  making somebody retype them is how the abstract number ends up wrong in
 *  Zoho. Only what IN4 genuinely cannot know is left to type.
 *
 *  If there is no work order, nothing here applies and every field stays
 *  editable. That case is a third of all bills and must not feel like an error. */

export interface PickableWo {
  woId: number
  woNo: string
  projectId: number | null
  contractorId: number | null
  contractor: string
  /** Ordered value including GST — the figure to compare a bill against. */
  orderedGross: number
  /** Everything certified so far, including GST. */
  billedGross: number
  /** orderedGross − billedGross, floored at zero. */
  balance: number
  /** Retention percentage IN4 actually applies on this work order. It is per
   *  work order, not a house rule: some carry 5%, some carry none. */
  retentionPct: number | null
  /** SRASSK / SRET / SRJT, read off the work-order number. */
  trust: string | null
  /** How many bills already exist — so the form can suggest the next one. */
  bills: number
  /** The bill number the last certificate carried, for the running-account
   *  series the site actually uses. */
  lastBillNo: string | null
  status: string | null
}

const DEAD = new Set(['cancelled', 'reversed'])

interface WoRow {
  wo_id: number; display_no: string | null; contractor_id: number | null
  wo_value: number | null; wo_gross_value: number | null; wo_retention_amt: number | null
  status_name: string | null
}
interface CertRow {
  wo_id: number; project_id: number | null; subproject_id: number | null; status_name: string | null
  gross_bill_amt: number | null; retention_amt: number | null
  certified_amt: number | null; invoice_no: string | null; creation_dt: string | null
}

export function buildPickList(
  wos: WoRow[], certs: CertRow[], contractors: Map<number, string>,
): PickableWo[] {
  const agg = new Map<number, {
    projectId: number | null; billed: number; certified: number; retention: number
    bills: number; lastNo: string | null; lastDate: string | null
  }>()

  for (const c of certs) {
    if (DEAD.has((c.status_name ?? '').trim().toLowerCase())) continue
    let a = agg.get(c.wo_id)
    if (!a) { a = { projectId: null, billed: 0, certified: 0, retention: 0, bills: 0, lastNo: null, lastDate: null }; agg.set(c.wo_id, a) }
    if (a.projectId == null && c.project_id != null) a.projectId = c.project_id
    a.billed += Number(c.gross_bill_amt || 0)
    a.certified += Number(c.certified_amt || 0)
    a.retention += Number(c.retention_amt || 0)
    a.bills++
    if (c.creation_dt && (!a.lastDate || c.creation_dt > a.lastDate)) {
      a.lastDate = c.creation_dt
      a.lastNo = c.invoice_no ?? null
    }
  }

  const out: PickableWo[] = []
  for (const w of wos) {
    if (!w.display_no) continue
    const a = agg.get(w.wo_id)
    const orderedGross = Number(w.wo_gross_value || 0)
    const billedGross = a?.billed ?? 0
    // Derived from what IN4 actually deducted, not assumed: retention over the
    // basic certified value is the rate that has really been applied.
    const pct = a && a.certified > 0 ? Math.round((a.retention / a.certified) * 1000) / 10 : null
    out.push({
      woId: w.wo_id,
      woNo: w.display_no,
      projectId: a?.projectId ?? null,
      contractorId: w.contractor_id,
      contractor: (w.contractor_id != null && contractors.get(w.contractor_id)) || '',
      orderedGross,
      billedGross,
      balance: Math.max(0, orderedGross - billedGross),
      retentionPct: pct,
      trust: trustOf(w.display_no),
      bills: a?.bills ?? 0,
      lastBillNo: a?.lastNo ?? null,
      status: w.status_name,
    })
  }

  // Most recently numbered first — the work order somebody is billing against
  // today is almost never the oldest one on the project.
  out.sort((a, b) => b.woId - a.woId)
  return out
}

export interface PickData { wos: PickableWo[]; projects: Array<{ id: number; name: string }> }

export async function loadPickList(sb: SupabaseClient): Promise<PickData> {
  const pageAll = async <T,>(table: string, cols: string): Promise<T[]> => {
    const out: T[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from(table).select(cols).range(from, from + 999)
      if (error) throw new Error(`${table}: ${error.message}`)
      const rows = (data ?? []) as unknown as T[]
      out.push(...rows)
      if (rows.length < 1000) return out
    }
  }

  const [wos, certs, parties, projects] = await Promise.all([
    pageAll<WoRow>('in4_work_orders', 'wo_id, display_no, contractor_id, wo_value, wo_gross_value, wo_retention_amt, status_name'),
    pageAll<CertRow>('in4_wo_certificates', 'wo_id, project_id, subproject_id, status_name, gross_bill_amt, retention_amt, certified_amt, invoice_no, creation_dt'),
    pageAll<{ id: number; name: string; kind: string }>('in4_parties', 'id, name, kind'),
    pageAll<{ id: number; name: string }>('in4_projects', 'id, name'),
  ])

  // in4_parties is keyed on (kind, id) — a supplier and a contractor can share
  // an id, so filtering by kind is not optional.
  const contractors = new Map(parties.filter(p => p.kind === 'contractor').map(p => [p.id, p.name]))
  // Billed-to-date and the RA count must not include design or consultancy
  // certificates, or the balance offered on a construction bill is wrong.
  const excluded = await loadOutOfScope(sb)
  const inScope = certs.filter(c => !rowOutOfScope(excluded, c.subproject_id))
  return { wos: buildPickList(wos, inScope, contractors), projects }
}
