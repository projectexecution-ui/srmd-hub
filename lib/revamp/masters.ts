// The one Masters list that is CT Hub's own rather than IN4's: the physical
// stores, held by two modules (Warehouse V2 and the old Inventory). The six
// masters of the mind map — trust, project, contact, categories, item, BOQ —
// live in masters-in4.ts and come from IN4.

import { createClient } from '@/lib/supabase/server'

/** Normalise a name for comparison: case, spacing and punctuation differ
 *  between IN4 exports and what people typed into the hub. */
export function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface StoreRow {
  name: string
  code: string | null
  source: 'Warehouse' | 'Inventory (old)'
  ownerProject: string | null
  keeper: string | null
  items: number
}

export async function loadStores(): Promise<StoreRow[]> {
  const supabase = await createClient()
  const [whRes, invRes, stockRes, projRes, profRes] = await Promise.all([
    supabase.from('wh_locations').select('id, code, name, project_id, keeper_id').is('deleted_at', null),
    supabase.from('inv_warehouses').select('id, code, name, location').is('deleted_at', null),
    supabase.from('wh_stock').select('location_id'),
    supabase.from('projects').select('id, name'),
    supabase.from('profiles').select('id, full_name, name, email'),
  ])

  const projName = new Map(((projRes.data ?? []) as Array<{ id: string; name: string }>).map(p => [p.id, p.name]))
  const person = new Map(((profRes.data ?? []) as Array<Record<string, unknown>>).map(p =>
    [p.id as string, (p.full_name as string) || (p.name as string) || (p.email as string) || '—']))
  const stock = new Map<string, number>()
  for (const s of (stockRes.data ?? []) as Array<{ location_id: string }>) {
    stock.set(s.location_id, (stock.get(s.location_id) ?? 0) + 1)
  }

  const wh: StoreRow[] = ((whRes.data ?? []) as Array<Record<string, unknown>>).map(l => ({
    name: String(l.name ?? ''),
    code: (l.code as string | null) ?? null,
    source: 'Warehouse',
    ownerProject: l.project_id ? (projName.get(l.project_id as string) ?? null) : null,
    keeper: l.keeper_id ? (person.get(l.keeper_id as string) ?? null) : null,
    items: stock.get(l.id as string) ?? 0,
  }))

  const inv: StoreRow[] = ((invRes.data ?? []) as Array<Record<string, unknown>>).map(w => ({
    name: String(w.name ?? ''),
    code: (w.code as string | null) ?? null,
    source: 'Inventory (old)',
    ownerProject: (w.location as string | null) ?? null,
    keeper: null,
    items: 0,
  }))

  return [...wh, ...inv].sort((a, b) => a.name.localeCompare(b.name))
}
