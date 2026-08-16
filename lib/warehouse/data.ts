import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, getMyProfile, can } from '@/lib/auth'
import { showValuesFor, isOn } from './settings'
import type { SettingValues } from './settings'
import type { GateInOptions, WhItem, WhPo, WhPoHead, WhPoLine, WhSite, WhSpot, WhLists, StockRow } from './types'
import type { CountLine } from './count'

/** PostgREST embeds a to-one relation as an object at runtime, but the generated
 *  types describe it as an array. This normalises both shapes so callers can
 *  read `.name` without casting through `unknown`. */
export function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

/** Every wh_* setting, in one read. Screens and actions both go through this so
 *  a rule is never read two different ways. */
export async function getSettings(): Promise<SettingValues> {
  const sb = await createClient()
  const { data } = await sb.from('app_settings').select('key, value').like('key', 'wh_%')
  const out: SettingValues = {}
  for (const r of data ?? []) out[r.key] = r.value ?? ''
  return out
}

/** Does the signed-in person see rates and ₹? One definition for the module. */
export async function getShowValues(): Promise<boolean> {
  const [values, profile, perms] = await Promise.all([getSettings(), getMyProfile(), getMyPermissions()])
  return showValuesFor(values, profile?.role, can(perms, 'warehouse', 'admin'))
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
  const [me, perms] = await Promise.all([getMyUser(), getMyPermissions()])
  const allSpots = sites.flatMap(s => s.spots)

  // Admins and Atm Heads are not tied to one store.
  if (can(perms, 'warehouse', 'admin')) return { ids: allSpots.map(s => s.id), scopingOff: true }

  // Default OFF: a keeper posts only where he actually stands.
  const values = await getSettings()
  if (isOn(values, 'wh_any_keeper_any_store')) {
    return { ids: allSpots.map(s => s.id), scopingOff: true }
  }

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
    .select('id, code, name, unit, category, discipline, last_rate')
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('name')
  return (data ?? []).map(r => ({
    id: r.id, code: r.code, name: r.name, unit: r.unit,
    category: r.category, discipline: r.discipline, lastRate: r.last_rate,
  }))
}

/** Every open PO, but only enough of each to find it in a list.
 *
 *  Deliberately WITHOUT lines. There are 1,223 open POs carrying 4,067 lines
 *  between them; sending all of that to a phone at a gate was half a megabyte of
 *  JSON to render one dropdown. The lines come from getPoBalance() for the one
 *  PO he actually picks. */
export async function getOpenPoHeads(): Promise<{ heads: WhPoHead[]; error?: string }> {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_po')
    .select('id, po_no, vendor, entity, status, po_date, project_id, projects(name)')
    .is('deleted_at', null)
    .in('status', ['open', 'partly_received'])
    .order('po_date', { ascending: false })
  if (error) return { heads: [], error: error.message }

  return {
    heads: (data ?? []).map<WhPoHead>(p => ({
      id: p.id,
      poNo: p.po_no,
      vendor: p.vendor,
      entity: p.entity,
      projectId: p.project_id,
      projectName: one(p.projects)?.name ?? null,
      status: p.status,
      poDate: p.po_date,
    })),
  }
}

/** One PO with its per-line running balance.
 *
 *  `pending` = ordered − received-so-far. A PO of 5,000 bags arriving in ten
 *  trucks is the NORMAL case, so the PO is never consumed by one entry. This is
 *  a completely different number from the challan shortage. (#21 vs #9)
 *
 *  Scoped to ONE purchase order on purpose. Fetching every received quantity in
 *  one go meant an `in(...)` over all 4,067 line ids — a 150,000-character URL
 *  that PostgREST refuses outright. The failure was silent, too: the error was
 *  never read, so every line would simply have reported its full ordered
 *  quantity as still pending once real receipts existed. */
export async function getPoBalance(poId: string): Promise<{ po: WhPo | null; error?: string }> {
  const sb = await createClient()
  const { data: p, error } = await sb
    .from('wh_po')
    .select('id, po_no, kind, vendor, entity, status, project_id, wh_po_lines(id, item_id, ordered_qty, rate, source_text, wh_items(name, unit))')
    .eq('id', poId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return { po: null, error: error.message }
  if (!p) return { po: null }

  const lineIds = (p.wh_po_lines ?? []).map((l: { id: string }) => l.id)
  const received = new Map<string, number>()
  const deliveries = new Set<string>()
  if (lineIds.length > 0) {
    const { data: got, error: gErr } = await sb
      .from('wh_gate_in_lines')
      .select('po_line_id, received_qty, gate_in_id')
      .in('po_line_id', lineIds)
    if (gErr) return { po: null, error: `Could not read what has already arrived: ${gErr.message}` }
    for (const g of got ?? []) {
      if (!g.po_line_id) continue
      received.set(g.po_line_id, (received.get(g.po_line_id) ?? 0) + Number(g.received_qty))
      deliveries.add(g.gate_in_id)
    }
  }

  return {
    po: {
      id: p.id,
      poNo: p.po_no,
      kind: p.kind,
      vendor: p.vendor,
      entity: p.entity,
      status: p.status,
      projectId: p.project_id,
      deliveries: deliveries.size,
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
          sourceText: l.source_text ?? null,
        }
      }),
    },
  }
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
  const [{ ids, scopingOff }, items, poRes, lists, projectsRes, nextNo] = await Promise.all([
    getPostableSpots(sites),
    getItems(),
    getOpenPoHeads(),
    getLists(),
    sb.from('projects').select('id, name').order('name'),
    peekNextEntryNo('in'),
  ])
  return {
    sites,
    postableSpotIds: ids,
    scopingOff,
    items,
    poHeads: poRes.heads,
    poError: poRes.error ?? null,
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

/** Every stock line with its item and location resolved. Small enough to hold
 *  in one page at gate volumes, and it lets the OUT form filter by store
 *  without a round trip per selection. */
export async function getStockRows(): Promise<StockRow[]> {
  const sb = await createClient()
  const [{ data: stock }, sites] = await Promise.all([
    sb.from('wh_stock').select('item_id, location_id, qty, damaged_qty, min_qty, wh_items(name, unit)'),
    getLocationTree(),
  ])
  const spot = new Map(sites.flatMap(s => s.spots).map(sp => [sp.id, sp]))
  return (stock ?? []).flatMap(r => {
    const sp = spot.get(r.location_id)
    const item = one(r.wh_items)
    if (!sp || !item) return []
    return [{
      itemId: r.item_id, itemName: item.name, unit: item.unit,
      locationId: r.location_id, locationName: sp.name, siteName: sp.siteName,
      qty: Number(r.qty), damagedQty: Number(r.damaged_qty),
      minQty: r.min_qty == null ? null : Number(r.min_qty),
    }]
  }).sort((a, b) => a.itemName.localeCompare(b.itemName))
}

/** People an issue can be handed to. */
export async function getReceivers(): Promise<Array<{ id: string; name: string }>> {
  const sb = await createClient()
  const { data } = await sb
    .from('profiles')
    .select('id, full_name, email, role')
    .order('full_name')
  return (data ?? []).map(p => ({ id: p.id, name: p.full_name || p.email || 'Unnamed' }))
}

/** Parties who have brought their own material in, so a vendor return can be
 *  matched to its IN by picking the same name instead of retyping it. */
export async function getVendorNames(): Promise<string[]> {
  const sb = await createClient()
  const { data } = await sb
    .from('wh_gate_in')
    .select('party')
    .eq('owner', 'vendor')
    .is('deleted_at', null)
  return [...new Set((data ?? []).map(r => r.party).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** Recent OUT entries — site issues, store moves and vendor returns. */
export async function getRecentOuts(limit = 15) {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_gate_out')
    .select(`id, entry_no, entry_date, dest_type, is_returnable, return_due_date, entity, confirmed_at, party,
             from_loc:wh_locations!wh_gate_out_from_location_id_fkey(name),
             to_loc:wh_locations!wh_gate_out_to_location_id_fkey(name),
             projects(name),
             wh_gate_out_lines(id, qty, rate, returned_qty, wh_items(name, unit))`)
    .is('deleted_at', null)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  return { rows: data ?? [], error }
}

/** One count with its sheet, resolved for the walking screen. */
export async function getCount(id: string) {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_counts')
    .select(`id, count_no, location_id, scope, status, blind, started_at, submitted_at,
             approved_at, reject_reason, counted_by, witness_id,
             counter:profiles!wh_counts_counted_by_fkey(full_name, email),
             witness:profiles!wh_counts_witness_id_fkey(full_name, email),
             approver:profiles!wh_counts_approved_by_fkey(full_name, email),
             wh_locations(name, parent_id),
             wh_count_lines(id, item_id, seq, book_qty, counted_qty, skipped, skip_reason,
                            reason, remark, photo_url, wh_items(name, unit, last_rate))`)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return { count: null, lines: [] as CountLine[], error }

  const lines = (data.wh_count_lines ?? [])
    .map((l): CountLine => {
      const item = one(l.wh_items)
      return {
        id: l.id,
        itemId: l.item_id,
        itemName: item?.name ?? '—',
        unit: item?.unit ?? '',
        seq: l.seq,
        bookQty: Number(l.book_qty),
        countedQty: l.counted_qty == null ? null : Number(l.counted_qty),
        skipped: l.skipped,
        skipReason: l.skip_reason,
        reason: l.reason,
        remark: l.remark,
        rate: item?.last_rate == null ? null : Number(item.last_rate),
      }
    })
    .sort((a, b) => a.seq - b.seq || a.itemName.localeCompare(b.itemName))

  return { count: data, lines, error: null }
}

/** Counts for the register list — open ones first, because an abandoned count
 *  left half-walked is the thing most worth seeing. */
export async function getRecentCounts(limit = 20) {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_counts')
    .select(`id, count_no, scope, status, blind, started_at, submitted_at, approved_at,
             counter:profiles!wh_counts_counted_by_fkey(full_name, email),
             wh_locations(name),
             wh_count_lines(id, book_qty, counted_qty, skipped)`)
    .order('started_at', { ascending: false })
    .limit(limit)
  return { rows: data ?? [], error }
}

/** Recent IN entries for the register list under the form. */
export async function getRecentIns(limit = 15) {
  const sb = await createClient()
  const { data, error } = await sb
    .from('wh_gate_in')
    .select(`id, entry_no, entry_date, party, owner, entity, po_no_text, no_po_reason,
             photo_urls,
             wh_locations(name), wh_po(po_no),
             wh_gate_in_lines(id, challan_qty, received_qty, damaged_qty, short_qty, good_qty, rate,
                              differs_from_po, differ_note,
                              wh_items(name, unit),
                              po_line:wh_po_lines(source_text, wh_items(name)))`)
    .is('deleted_at', null)
    .order('entry_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  return { rows: data ?? [], error }
}
