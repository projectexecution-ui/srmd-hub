// Server-side loader for a day's stock movements, enriched with the request
// context that makes the daily report "accurate": for issues/returns it pulls
// the project, the engineer who requested it, the purpose and the request no.
// Used by BOTH the in-app daily page and the email cron so they never drift.
import type { SupabaseClient } from '@supabase/supabase-js'
import { istDayRange } from './day-window'
import type { RawMovement } from './daily-movement'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

export async function fetchDayRawMovements(
  supabase: Client, istDate: string,
): Promise<{ rows: RawMovement[]; error: { message: string } | null }> {
  const { startUtc, endUtc } = istDayRange(istDate)

  const { data: moves, error } = await supabase
    .from('inv_stock_movements')
    .select('movement_type, qty, remarks, created_at, item_id, warehouse_id, actor_id, ref_table, ref_id, inv_items(code, name, unit), inv_warehouses(code, name)')
    .gte('created_at', startUtc).lt('created_at', endUtc)
    .order('created_at')
  const rows = moves ?? []

  // Requests referenced by the request-linked movements (issue/return).
  const refIds = [...new Set(rows
    .filter(m => m.ref_table === 'inv_requests' && m.ref_id)
    .map(m => m.ref_id as string))]
  const { data: reqs } = refIds.length
    ? await supabase.from('inv_requests')
        .select('id, request_no, purpose, is_emergency, project_id, engineer_id').in('id', refIds)
    : { data: [] as Array<{ id: string; request_no: string | null; purpose: string | null; is_emergency: boolean | null; project_id: string | null; engineer_id: string | null }> }
  const reqById = new Map((reqs ?? []).map(r => [r.id as string, r]))

  const projectIds = [...new Set((reqs ?? []).map(r => r.project_id).filter(Boolean) as string[])]
  const { data: projs } = projectIds.length
    ? await supabase.from('projects').select('id, code, name').in('id', projectIds)
    : { data: [] as Array<{ id: string; code: string; name: string }> }
  const projById = new Map((projs ?? []).map(p => [p.id as string, `${p.code} — ${p.name}`]))

  const actorIds = rows.map(m => m.actor_id as string | null).filter(Boolean) as string[]
  const engineerIds = (reqs ?? []).map(r => r.engineer_id).filter(Boolean) as string[]
  const profileIds = [...new Set([...actorIds, ...engineerIds])]
  const { data: profs } = profileIds.length
    ? await supabase.from('profiles').select('id, full_name, name').in('id', profileIds)
    : { data: [] as Array<{ id: string; full_name: string | null; name: string | null }> }
  const nameById = new Map((profs ?? []).map(p => [p.id as string, (p.full_name ?? p.name ?? 'Someone') as string]))

  const mapped: RawMovement[] = rows.map(m => {
    const it = one(m.inv_items as never) as { code?: string; name?: string; unit?: string } | null
    const wh = one(m.inv_warehouses as never) as { code?: string; name?: string } | null
    const req = (m.ref_table === 'inv_requests' && m.ref_id) ? reqById.get(m.ref_id as string) : null
    return {
      movement_type: m.movement_type as string,
      qty: Number(m.qty || 0),
      remarks: (m.remarks as string) ?? null,
      created_at: m.created_at as string,
      item_id: m.item_id as string,
      warehouse_id: m.warehouse_id as string,
      item_code: it?.code ?? '',
      item_name: it?.name ?? 'Item',
      unit: it?.unit ?? '',
      store_code: wh?.code ?? '',
      store_name: wh?.name ?? '',
      actor_name: (m.actor_id ? nameById.get(m.actor_id as string) : null) ?? 'Someone',
      project: req?.project_id ? (projById.get(req.project_id) ?? null) : null,
      requested_by: req?.engineer_id ? (nameById.get(req.engineer_id) ?? null) : null,
      purpose: req?.purpose ?? null,
      reference: req?.request_no ?? null,
      is_emergency: req?.is_emergency ?? false,
    }
  })
  return { rows: mapped, error: error ? { message: error.message } : null }
}
