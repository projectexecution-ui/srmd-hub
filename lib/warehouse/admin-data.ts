/** Reads for the correction screens. Writes live in admin-actions.ts. */

import { createClient } from '@/lib/supabase/server'
import { one } from './data'
import { outstandingOf } from './corrections'
import { getRoleLabels } from '@/lib/role-labels'
import { ALL_ROLES } from '@/lib/types'
import type { ReturnableOutLine } from './corrections'
import type { HideableRole } from './settings'

// ===========================================================================
// Stores and sites
// ===========================================================================

export type AdminLocation = {
  id: string
  parentId: string | null
  code: string
  name: string
  keeperId: string | null
  active: boolean
  /** The project whose stock this store holds; null means shared. */
  projectId: string | null
  projectName: string | null
  /** Stores under a site, sites have none. */
  children: AdminLocation[]
}

/** Every store INCLUDING the retired ones — the settings screen is the only
 *  place a retired store can be brought back, so it is the one place that must
 *  still be able to see it. */
export async function getAllLocations(): Promise<{ sites: AdminLocation[]; error?: string }> {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_locations')
    .select('id, parent_id, code, name, keeper_id, is_active, deleted_at, project_id, projects(name)')
    .order('sort').order('name')
  if (error) return { sites: [], error: error.message }

  const rows = (data ?? []).map(r => ({
    id: r.id, parentId: r.parent_id, code: r.code, name: r.name,
    keeperId: r.keeper_id,
    projectId: r.project_id ?? null,
    projectName: one(r.projects)?.name ?? null,
    active: r.is_active && r.deleted_at == null,
    children: [] as AdminLocation[],
  }))
  const sites = rows.filter(r => !r.parentId)
  for (const s of sites) s.children = rows.filter(r => r.parentId === s.id)
  return { sites }
}

// ===========================================================================
// Gate entries
// ===========================================================================

export type EntryRow = {
  kind: 'in' | 'out'
  id: string
  entryNo: string
  day: string
  /** Supplier for an IN; where it went for an OUT. */
  who: string
  storeName: string
  lines: number
  qty: number
  voided: boolean
  voidReason: string | null
  /** OUT only: material that is still out on loan. */
  outstanding: number
}

/** The recent gate register, both directions in one list.
 *
 *  Voided entries are shown, struck through, rather than hidden. A register
 *  that quietly drops what was cancelled is exactly the register nobody can
 *  audit. */
export async function getEntries(limit = 120): Promise<{ rows: EntryRow[]; error?: string }> {
  const sb = await createClient()
  const [inRes, outRes] = await Promise.all([
    sb.from('wh_gate_in')
      .select(`id, entry_no, entry_date, party, deleted_at, void_reason,
               wh_locations(name), wh_gate_in_lines(id, received_qty)`)
      .order('entry_date', { ascending: false }).order('entry_no', { ascending: false })
      .limit(limit),
    sb.from('wh_gate_out')
      .select(`id, entry_no, entry_date, dest_type, party, deleted_at, void_reason, is_returnable,
               from:wh_locations!wh_gate_out_from_location_id_fkey(name),
               projects(name),
               wh_gate_out_lines(id, qty, returned_qty)`)
      .order('entry_date', { ascending: false }).order('entry_no', { ascending: false })
      .limit(limit),
  ])
  if (inRes.error) return { rows: [], error: inRes.error.message }
  if (outRes.error) return { rows: [], error: outRes.error.message }

  const rows: EntryRow[] = []
  for (const e of inRes.data ?? []) {
    const lines = e.wh_gate_in_lines ?? []
    rows.push({
      kind: 'in', id: e.id, entryNo: e.entry_no, day: e.entry_date,
      who: e.party || '— not named —',
      storeName: one(e.wh_locations)?.name ?? '—',
      lines: lines.length,
      qty: lines.reduce((s, l) => s + Number(l.received_qty), 0),
      voided: e.deleted_at != null, voidReason: e.void_reason, outstanding: 0,
    })
  }
  for (const e of outRes.data ?? []) {
    const lines = e.wh_gate_out_lines ?? []
    rows.push({
      kind: 'out', id: e.id, entryNo: e.entry_no, day: e.entry_date,
      who: e.dest_type === 'site' ? (one(e.projects)?.name ?? 'a site')
        : e.dest_type === 'vendor' ? (e.party || 'a vendor')
        : 'another store',
      storeName: one(e.from)?.name ?? '—',
      lines: lines.length,
      qty: lines.reduce((s, l) => s + Number(l.qty), 0),
      voided: e.deleted_at != null, voidReason: e.void_reason,
      outstanding: e.is_returnable && !e.deleted_at
        ? lines.reduce((s, l) => s + Math.max(0, Number(l.qty) - Number(l.returned_qty)), 0)
        : 0,
    })
  }
  rows.sort((a, b) => b.day.localeCompare(a.day) || b.entryNo.localeCompare(a.entryNo))
  return { rows: rows.slice(0, limit) }
}

export type EntryDetail = {
  kind: 'in' | 'out'
  id: string
  entryNo: string
  day: string
  voided: boolean
  voidReason: string | null
  voidedBy: string | null
  createdBy: string | null
  createdByName: string | null
  /** Label → value, everything worth showing about the header. */
  facts: Array<[string, string]>
  storeName: string
  photoUrls: string[]
  lines: Array<{
    lineId: string
    itemName: string
    unit: string
    qty: number
    /** IN only. */
    damaged?: number
    short?: number
    /** OUT + returnable only. */
    returned?: number
    outstanding?: number
  }>
  /** OUT only: can material be booked back in against this entry? */
  returnable: boolean
}

export async function getEntryDetail(
  kind: 'in' | 'out',
  id: string,
): Promise<{ entry: EntryDetail | null; error?: string }> {
  const sb = await createClient()

  if (kind === 'in') {
    const { data: e, error } = await sb.from('wh_gate_in')
      .select(`id, entry_no, entry_date, owner, party, entity, challan_no, challan_date,
               vehicle_no, driver_mobile, delivery_mode, remarks, photo_urls,
               po_no_text, no_po_reason, deleted_at, void_reason, created_by,
               wh_po(po_no), wh_locations(name), projects(name),
               creator:profiles!wh_gate_in_created_by_fkey(full_name, email),
               voider:profiles!wh_gate_in_deleted_by_fkey(full_name, email),
               wh_gate_in_lines(id, received_qty, damaged_qty, short_qty, wh_items(name, unit))`)
      .eq('id', id).maybeSingle()
    if (error) return { entry: null, error: error.message }
    if (!e) return { entry: null }

    const facts: Array<[string, string]> = [
      ['Owner', e.owner === 'vendor' ? 'Vendor’s own material' : 'Ours (purchased)'],
      ['Supplier', e.party || '—'],
      ['Purchase order', one(e.wh_po)?.po_no ?? e.po_no_text ?? (e.no_po_reason ? `none — ${e.no_po_reason}` : 'none')],
      ['Paid by', e.entity ?? '—'],
      ['Project', one(e.projects)?.name ?? '—'],
      ['Challan', [e.challan_no, e.challan_date].filter(Boolean).join(' · ') || '—'],
      ['Vehicle', [e.vehicle_no, e.driver_mobile].filter(Boolean).join(' · ') || '—'],
      ['Delivered by', e.delivery_mode ?? '—'],
      ['Remarks', e.remarks || '—'],
    ]
    return {
      entry: {
        kind: 'in', id: e.id, entryNo: e.entry_no, day: e.entry_date,
        voided: e.deleted_at != null, voidReason: e.void_reason,
        voidedBy: personName(e.voider),
        createdBy: e.created_by, createdByName: personName(e.creator),
        facts, storeName: one(e.wh_locations)?.name ?? '—',
        photoUrls: e.photo_urls ?? [],
        lines: (e.wh_gate_in_lines ?? []).map(l => ({
          lineId: l.id,
          itemName: one(l.wh_items)?.name ?? '—',
          unit: one(l.wh_items)?.unit ?? '',
          qty: Number(l.received_qty),
          damaged: Number(l.damaged_qty),
          short: Math.max(0, Number(l.short_qty ?? 0)),
        })),
        returnable: false,
      },
    }
  }

  const { data: e, error } = await sb.from('wh_gate_out')
    .select(`id, entry_no, entry_date, dest_type, party, entity, vehicle_no, remarks,
             is_returnable, return_due_date, confirmed_at, deleted_at, void_reason, created_by,
             from:wh_locations!wh_gate_out_from_location_id_fkey(name),
             to:wh_locations!wh_gate_out_to_location_id_fkey(name),
             projects(name),
             engineer:profiles!wh_gate_out_engineer_id_fkey(full_name, email),
             creator:profiles!wh_gate_out_created_by_fkey(full_name, email),
             voider:profiles!wh_gate_out_deleted_by_fkey(full_name, email),
             wh_gate_out_lines(id, qty, returned_qty, wh_items(name, unit))`)
    .eq('id', id).maybeSingle()
  if (error) return { entry: null, error: error.message }
  if (!e) return { entry: null }

  const facts: Array<[string, string]> = [
    ['Where to', e.dest_type === 'site' ? `Site — ${one(e.projects)?.name ?? '—'}`
      : e.dest_type === 'store' ? `Store — ${one(e.to)?.name ?? '—'}`
      : `Back to vendor — ${e.party ?? '—'}`],
    ['Paid by', e.entity ?? '—'],
    ['Engineer', personName(e.engineer) ?? '—'],
    ['Returnable', e.is_returnable ? `yes${e.return_due_date ? ` · due ${e.return_due_date}` : ''}` : 'no'],
    ['Confirmed at site', e.confirmed_at ? 'yes' : 'not yet'],
    ['Vehicle', e.vehicle_no ?? '—'],
    ['Remarks', e.remarks || '—'],
  ]
  return {
    entry: {
      kind: 'out', id: e.id, entryNo: e.entry_no, day: e.entry_date,
      voided: e.deleted_at != null, voidReason: e.void_reason,
      voidedBy: personName(e.voider),
      createdBy: e.created_by, createdByName: personName(e.creator),
      facts, storeName: one(e.from)?.name ?? '—', photoUrls: [],
      lines: (e.wh_gate_out_lines ?? []).map(l => ({
        lineId: l.id,
        itemName: one(l.wh_items)?.name ?? '—',
        unit: one(l.wh_items)?.unit ?? '',
        qty: Number(l.qty),
        returned: Number(l.returned_qty),
        outstanding: outstandingOf({
          lineId: l.id, itemId: '', itemName: '', unit: '',
          qty: Number(l.qty), returnedQty: Number(l.returned_qty),
        } satisfies ReturnableOutLine),
      })),
      returnable: e.is_returnable && e.deleted_at == null,
    },
  }
}

function personName(p: unknown): string | null {
  const o = one(p as never) as { full_name?: string | null; email?: string | null } | null
  return o ? (o.full_name || o.email || null) : null
}

// ===========================================================================
// The item master
// ===========================================================================

export type ItemRow = {
  id: string
  name: string
  unit: string
  category: string | null
  discipline: string | null
  code: string | null
  source: string
  active: boolean
  lastRate: number | null
  /** Filled only for the item being opened — counting for 2,803 rows at once
   *  would be four table scans to render a list nobody has scrolled yet. */
  stockQty: number
  movements: number
}

/** How many items sit in each category. Drives the filter chips, and it is a
 *  cheap aggregate rather than counting 2,803 rows on the client. */
export async function getCategoryCounts(
  includeRetired = false,
): Promise<{ counts: Array<{ category: string; n: number }>; total: number; error?: string }> {
  const sb = await createClient()
  let q = sb.from('wh_items').select('category')
  if (!includeRetired) q = q.is('deleted_at', null)
  const { data, error } = await q
  if (error) return { counts: [], total: 0, error: error.message }

  const map = new Map<string, number>()
  for (const r of data ?? []) {
    const k = r.category?.trim() || 'Not categorised'
    map.set(k, (map.get(k) ?? 0) + 1)
  }
  return {
    total: data?.length ?? 0,
    // Biggest first — the chip row is scanned left to right and the big
    // families are the ones anybody is actually looking for.
    counts: [...map.entries()]
      .map(([category, n]) => ({ category, n }))
      .sort((a, b) => b.n - a.n || a.category.localeCompare(b.category)),
  }
}

/** The master, searched server-side. 2,803 items is too many to ship to a
 *  phone, and an item screen is always opened looking for one thing. */
export async function searchItems(
  q: string,
  opts: { includeRetired?: boolean; limit?: number; category?: string } = {},
): Promise<{ rows: ItemRow[]; total: number; error?: string }> {
  const sb = await createClient()
  const limit = opts.limit ?? 60

  let query = sb.from('wh_items')
    .select('id, name, unit, category, discipline, code, source, is_active, deleted_at, last_rate',
      { count: 'exact' })
  if (!opts.includeRetired) query = query.is('deleted_at', null)
  if (opts.category === 'Not categorised') query = query.is('category', null)
  else if (opts.category) query = query.eq('category', opts.category)
  if (q.trim()) query = query.or(`name.ilike.%${q.trim()}%,code.ilike.%${q.trim()}%`)

  const { data, error, count } = await query.order('name').limit(limit)
  if (error) return { rows: [], total: 0, error: error.message }

  const ids = (data ?? []).map(r => r.id)
  const stock = new Map<string, number>()
  if (ids.length > 0) {
    const { data: st } = await sb.from('wh_stock')
      .select('item_id, qty, damaged_qty').in('item_id', ids)
    for (const s of st ?? []) {
      stock.set(s.item_id, (stock.get(s.item_id) ?? 0) + Number(s.qty) + Number(s.damaged_qty))
    }
  }

  return {
    total: count ?? 0,
    rows: (data ?? []).map(r => ({
      id: r.id, name: r.name, unit: r.unit,
      category: r.category, discipline: r.discipline, code: r.code, source: r.source,
      active: r.is_active && r.deleted_at == null,
      lastRate: r.last_rate == null ? null : Number(r.last_rate),
      stockQty: stock.get(r.id) ?? 0,
      movements: 0,
    })),
  }
}

// ===========================================================================
// Roles that can be told not to see money
// ===========================================================================

/** Every assignable role except admin, with how many people hold it and
 *  whether it can open the warehouse at all.
 *
 *  Built from live data on purpose. The list this replaces was hardcoded, and
 *  it went stale silently — it offered two roles nobody held and one that
 *  cannot open the module, so a switch marked Recommended was protecting
 *  nobody while all forty people with access read every rate. A list derived
 *  from the roles that exist cannot drift like that. */
export async function getHideableRoles(): Promise<HideableRole[]> {
  const sb = await createClient()
  const [labels, counts, perms] = await Promise.all([
    getRoleLabels(),
    sb.from('profiles').select('role'),
    sb.from('role_permissions').select('role, can_view').eq('module_slug', 'warehouse'),
  ])

  const people = new Map<string, number>()
  for (const p of counts.data ?? []) {
    if (!p.role) continue
    people.set(p.role, (people.get(p.role) ?? 0) + 1)
  }
  const canView = new Map((perms.data ?? []).map(r => [r.role as string, r.can_view as boolean]))

  return ALL_ROLES
    // An admin always sees values — offering the chip would be a lie.
    .filter(r => r !== 'admin')
    .map(r => ({
      id: r,
      label: labels[r]?.label ?? r,
      people: people.get(r) ?? 0,
      hasAccess: canView.get(r) === true,
    }))
    // The roles with real people first: hiding money from 27 viewers is a
    // decision, hiding it from a role nobody holds is housekeeping.
    .sort((a, b) => b.people - a.people || a.label.localeCompare(b.label))
}
