'use server'

/** Feeds V1's catalogue generator from the V2 tables.
 *
 *  `lib/inventory/catalogue-report.ts` is a PURE formatter — it takes
 *  `CatalogueRow[]` and returns a jsPDF / workbook, and imports nothing from
 *  the old module's tables. So the document Aksha already knows is reused
 *  rather than reimplemented, and the two cannot drift apart in style.
 *  This file is the only place warehouse touches the inventory module, and it
 *  touches its TYPES, not its data. */

import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/warehouse/paging'

/** Just the shapes the catalogue needs, so the paged reads stay typed. */
type CatItem = {
  id: string; code: string | null; name: string; unit: string
  category: string | null; subcategory: string | null
  hsn_code: string | null; image_url: string | null; in4_name: string | null
}
type CatStock = {
  item_id: string; location_id: string
  qty: string; damaged_qty: string; min_qty: string | null
}
import { gate } from '@/lib/warehouse/guards'
import { one } from '@/lib/warehouse/data'
import type { CatalogueRow, WarehouseInfo } from '@/lib/inventory/catalogue-report'

export async function loadCatalogue(opts: { locationId?: string } = {}): Promise<{
  rows: CatalogueRow[]
  warehouses: WarehouseInfo[]
  scopeLabel: string
  error?: string
}> {
  const denied = await gate('view')
  if (denied) return { rows: [], warehouses: [], scopeLabel: '', error: denied }
  const sb = await createClient()

  const [itemsRes, stockRes, locRes] = await Promise.all([
    // Paged: a catalogue that stops at row 1,000 is not a catalogue, and the
    // PDF gave no hint that two thirds of the master was missing from it.
    fetchAll<CatItem>((from, to) => sb.from('wh_items')
      .select('id, code, name, unit, category, subcategory, hsn_code, image_url, in4_name')
      .is('deleted_at', null).eq('is_active', true)
      .order('category').order('name').range(from, to)),
    fetchAll<CatStock>((from, to) => sb.from('wh_stock')
      .select('item_id, location_id, qty, damaged_qty, min_qty')
      .order('item_id').range(from, to)),
    sb.from('wh_locations').select('id, code, name, parent_id')
      .is('deleted_at', null).eq('is_active', true),
  ])
  if (itemsRes.error) return { rows: [], warehouses: [], scopeLabel: '', error: itemsRes.error }
  if (stockRes.error) return { rows: [], warehouses: [], scopeLabel: '', error: stockRes.error }
  if (locRes.error) return { rows: [], warehouses: [], scopeLabel: '', error: locRes.error.message }

  // Only the stores (spots), never the sites — a site holds nothing itself.
  const stores = (locRes.data ?? []).filter(l => l.parent_id)
  const scoped = opts.locationId ? stores.filter(s => s.id === opts.locationId) : stores
  const byId = new Map(scoped.map(s => [s.id, s]))

  const perItem = new Map<string, Array<{ code: string; label: string; qty: number; low: boolean }>>()
  for (const s of stockRes.rows) {
    const loc = byId.get(s.location_id)
    if (!loc) continue
    const qty = Number(s.qty)
    if (qty <= 0) continue
    const min = s.min_qty == null ? null : Number(s.min_qty)
    if (!perItem.has(s.item_id)) perItem.set(s.item_id, [])
    perItem.get(s.item_id)!.push({
      code: loc.code, label: loc.name, qty,
      low: min != null && min > 0 && qty <= min,
    })
  }

  const rows: CatalogueRow[] = itemsRes.rows.map(i => {
    const st = perItem.get(i.id) ?? []
    const inHand = st.reduce((s, x) => s + x.qty, 0)
    return {
      code: i.code ?? '',
      name: i.name,
      // No description column on wh_items. IN4's own wording is the closest
      // thing to a spec line, and it is what the buyer ordered against.
      description: i.in4_name && i.in4_name !== i.name ? i.in4_name : null,
      unit: i.unit,
      category: i.category,
      subcategory: i.subcategory,
      hsn_code: i.hsn_code,
      image_url: i.image_url,
      in_hand: inHand,
      stores: st.sort((a, b) => b.qty - a.qty),
      low: inHand > 0 && st.some(x => x.low),
      out: inHand <= 0,
    }
  })

  return {
    rows,
    warehouses: scoped.map(s => ({ code: s.code, label: s.name })),
    scopeLabel: opts.locationId
      ? (byId.get(opts.locationId)?.name ?? 'One store')
      : 'All stores',
  }
}

/** The stores the catalogue can be scoped to, for the picker.
 *
 *  The site name is embedded through `!parent_id` — the FOREIGN KEY COLUMN, not
 *  the constraint name. PostgREST will not resolve a constraint-name hint on a
 *  self-reference: `wh_locations!wh_locations_parent_id_fkey` returns
 *  "Could not find a relationship between 'wh_locations' and 'wh_locations'",
 *  which is what this did, on every call, since it was written. The error was
 *  discarded, so the picker just rendered empty and nobody could scope an export
 *  to one store. Returning the error is the half that stops that repeating. */
export async function catalogueStores(): Promise<{
  stores: Array<{ id: string; name: string }>
  error?: string
}> {
  const denied = await gate('view')
  if (denied) return { stores: [], error: denied }
  const sb = await createClient()
  const { data, error } = await sb.from('wh_locations')
    .select('id, name, parent:wh_locations!parent_id(name)')
    .not('parent_id', 'is', null).is('deleted_at', null).eq('is_active', true)
    .order('name')
  if (error) return { stores: [], error: `Could not load the store list: ${error.message}` }
  return {
    stores: (data ?? []).map(l => ({
      id: l.id,
      name: one(l.parent)?.name ? `${one(l.parent)!.name} — ${l.name}` : l.name,
    })),
  }
}
