import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import type { GateInOptions, WhItem, WhPo, WhPoLine, WhSite, WhSpot, WhLists } from './types'

/** PostgREST embeds a to-one relation as an object at runtime, but the generated
 *  types describe it as an array. This normalises both shapes so callers can
 *  read `.name` without casting through `unknown`. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/** Storage locations as a two-level tree: site → spot. */
export async function getLocationTree(): Promise<WhSite[]> {
  const sb = await createClient()
  const { data } = await sb
    .from('wh_locations')
    .select('id, code, name, parent_id, keeper_id, sort')
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('sort')
    .order('name')

  const rows = data ?? []
  const sites = rows.filter(r => !r.parent_id)
  return sites.map(s => ({
    id: s.id,
    code: s.code,
    name: s.name,
    spots: rows
      .filter(r => r.parent_id === s.id)
      .map<WhSpot>(r => ({ id: r.id, code: r.code, name: r.name, siteName: s.name, keeperId: r.keeper_id })),
  }))
}

/** Which spots this user may POST entries in.
 *
 *  Roles say WHAT a person may do; this says WHERE. Without it, every keeper
 *  could post against every store and any Atm Head could approve any store's
 *  count — which would make the count approval close to meaningless. (#22)
 *
 *  Everyone with `view` still SEES stock everywhere; only writing is scoped. */
export async function getPostableSpots(sites: WhSite[]): Promise<{ ids: string[]; scopingOff: boolean }> {
  const [me, perms, sb] = await Promise.all([getMyUser(), getMyPermissions(), createClient()])
  const allSpots = sites.flatMap(s => s.spots)

  // Admins and Atm Heads are not tied to one store.
  if (can(perms, 'warehouse', 'admin')) return { ids: allSpots.map(s => s.id), scopingOff: true }

  const { data } = await sb
    .from('app_settings')
    .select('value')
    .eq('key', 'wh_any_keeper_any_store')
    .maybeSingle()
  // Default OFF: a keeper posts only where he actually stands.
  const anyStore = String(data?.value ?? 'false') === 'true'
  if (anyStore) return { ids: allSpots.map(s => s.id), scopingOff: true }

  const mine = allSpots.filter(s => s.keeperId && s.keeperId === me?.id)
  // A store with no keeper assigned yet is open — otherwise a fresh install
  // would let nobody post anything and the module would look broken.
  const unclaimed = allSpots.filter(s => !s.keeperId)
  return { ids: [...mine, ...unclaimed].map(s => s.id), scopingOff: false }
}

export async function getItems(): Promise<WhItem[]> {
  const sb = await createClient()
  const { data } = await sb
    .from('wh_items')
    .select('id, code, name, unit, category, last_rate')
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('name')
  return (data ?? []).map(r => ({
    id: r.id, code: r.code, name: r.name, unit: r.unit,
    category: r.category, lastRate: r.last_rate,
  }))
}

/** Open POs with a per-line running balance.
 *
 *  `pending` = ordered − received-so-far. A PO of 5,000 bags arriving in ten
 *  trucks is the NORMAL case, so the PO is never consumed by one entry. This is
 *  a completely different number from the challan shortage. (#21 vs #9) */
export async function getOpenPos(): Promise<WhPo[]> {
  const sb = await createClient()
  const { data: pos } = await sb
    .from('wh_po')
    .select('id, po_no, kind, vendor, entity, status, wh_po_lines(id, item_id, ordered_qty, rate, wh_items(name, unit))')
    .is('deleted_at', null)
    .in('status', ['open', 'partly_received'])
    .order('po_date', { ascending: false })

  const rows = pos ?? []
  if (rows.length === 0) return []

  // One round trip for every received quantity, rather than a query per line.
  const lineIds = rows.flatMap(p => (p.wh_po_lines ?? []).map((l: { id: string }) => l.id))
  const received = new Map<string, number>()
  const deliveries = new Map<string, Set<string>>()
  if (lineIds.length > 0) {
    const { data: got } = await sb
      .from('wh_gate_in_lines')
      .select('po_line_id, received_qty, gate_in_id')
      .in('po_line_id', lineIds)
    for (const g of got ?? []) {
      if (!g.po_line_id) continue
      received.set(g.po_line_id, (received.get(g.po_line_id) ?? 0) + Number(g.received_qty))
    }
    // deliveries-per-PO, so the form can say "delivery 8 of this PO"
    const lineToPo = new Map<string, string>()
    for (const p of rows) for (const l of p.wh_po_lines ?? []) lineToPo.set(l.id, p.id)
    for (const g of got ?? []) {
      const poId = g.po_line_id ? lineToPo.get(g.po_line_id) : undefined
      if (!poId) continue
      if (!deliveries.has(poId)) deliveries.set(poId, new Set())
      deliveries.get(poId)!.add(g.gate_in_id)
    }
  }

  return rows.map<WhPo>(p => ({
    id: p.id,
    poNo: p.po_no,
    kind: p.kind,
    vendor: p.vendor,
    entity: p.entity,
    status: p.status,
    deliveries: deliveries.get(p.id)?.size ?? 0,
    lines: (p.wh_po_lines ?? []).map((l): WhPoLine => {
      const ordered = Number(l.ordered_qty)
      const got = received.get(l.id) ?? 0
      const pending = ordered - got
      const item = one(l.wh_items)
      return {
        lineId: l.id,
        itemId: l.item_id,
        itemName: item?.name ?? '—',
        unit: item?.unit ?? '',
        ordered,
        received: got,
        pending: pending > 0 ? pending : 0,
        rate: l.rate,
        done: pending <= 0,
      }
    }),
  }))
}

export async function getLists(): Promise<WhLists> {
  const sb = await createClient()
  const { data } = await sb
    .from('wh_lists')
    .select('kind, value, sort')
    .eq('is_active', true)
    .order('sort')
    .order('value')
  const pick = (k: string) => (data ?? []).filter(r => r.kind === k).map(r => r.value)
  return {
    entity: pick('entity'),
    unit: pick('unit'),
    deliveryMode: pick('delivery_mode'),
    category: pick('category'),
    countReason: pick('count_reason'),
  }
}

/** Everything the Gate IN form needs, in one pass. */
export async function getGateInOptions(): Promise<GateInOptions> {
  const sb = await createClient()
  const sites = await getLocationTree()
  const [{ ids, scopingOff }, items, pos, lists, projectsRes, nextNo] = await Promise.all([
    getPostableSpots(sites),
    getItems(),
    getOpenPos(),
    getLists(),
    sb.from('projects').select('id, name').order('name'),
    peekNextEntryNo('in'),
  ])
  return {
    sites,
    postableSpotIds: ids,
    scopingOff,
    items,
    pos,
    lists,
    projects: (projectsRes.data ?? []) as Array<{ id: string; name: string }>,
    nextEntryNo: nextNo,
  }
}

/** The number the NEXT entry will get, for display only.
 *
 *  Deliberately does not call fn_wh_next_no(), which burns a number every time
 *  it runs — opening the form and walking away would leave a gap, and a gap is
 *  supposed to mean an unrecorded truck. (#1) */
export async function peekNextEntryNo(register: 'in' | 'out' | 'move' | 'count'): Promise<string> {
  const sb = await createClient()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const { data } = await sb
    .from('wh_number_series')
    .select('last_no')
    .eq('register', register)
    .eq('day', today)
    .maybeSingle()
  const next = (Number(data?.last_no ?? 0) + 1).toString().padStart(3, '0')
  const prefix = register === 'in' ? 'In' : register === 'out' ? 'Out' : register === 'move' ? 'Tr' : 'Ct'
  const d = new Date(today + 'T00:00:00')
  const stamp = `${String(d.getDate()).padStart(2, '0')}${d.toLocaleString('en-GB', { month: 'short' })}${String(d.getFullYear()).slice(2)}`
  return `${prefix}: ${stamp}/${next}`
}

/** Recent IN entries for the register list under the form. */
export async function getRecentIns(limit = 15) {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_gate_in')
    .select(`id, entry_no, entry_date, party, owner, entity, po_no_text, no_po_reason,
             wh_locations(name), wh_po(po_no),
             wh_gate_in_lines(id, challan_qty, received_qty, damaged_qty, short_qty, good_qty, rate, wh_items(name, unit))`)
    .is('deleted_at', null)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  return { rows: data ?? [], error }
}
