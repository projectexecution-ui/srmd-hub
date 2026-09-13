import type { SupabaseClient } from '@supabase/supabase-js'
import { rollCerts, type LaneWo, type LaneCert, type WoRoll } from './lanes'

/** Both lanes read the same two mirrors, so they load through here.
 *
 *  Everything is paged in 1,000s: PostgREST caps a plain select at 1,000 rows
 *  and silently returns the first page, which on ~4,700 certificates and
 *  ~2,200 work orders would quietly understate every figure on both pages
 *  rather than fail. */
async function pageAll<T>(
  sb: SupabaseClient, table: string, cols: string,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + PAGE - 1)
    if (error) return { rows, error: error.message }
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < PAGE) return { rows, error: null }
  }
}

export interface LaneData {
  wos: LaneWo[]
  rolls: Map<number, WoRoll>
  names: { contractor: Map<number, string>; project: Map<number, string> }
  error: string | null
}

export async function loadLaneData(sb: SupabaseClient): Promise<LaneData> {
  const [woRes, certRes, conRes, projRes] = await Promise.all([
    pageAll<LaneWo>(sb, 'in4_work_orders', 'wo_id, display_no, contractor_id, wo_gross_value, status_name'),
    pageAll<LaneCert>(sb, 'in4_wo_certificates', 'wo_id, project_id, certificate_type, status_name, gross_bill_amt, retention_amt, creation_dt'),
    pageAll<{ id: number; name: string; kind: string }>(sb, 'in4_parties', 'id, name, kind'),
    pageAll<{ id: number; name: string }>(sb, 'in4_projects', 'id, name'),
  ])

  return {
    wos: woRes.rows,
    rolls: rollCerts(certRes.rows),
    names: {
      contractor: new Map(conRes.rows.filter(c => c.kind === 'contractor').map(c => [c.id, c.name])),
      project: new Map(projRes.rows.map(p => [p.id, p.name])),
    },
    error: woRes.error ?? certRes.error ?? null,
  }
}
