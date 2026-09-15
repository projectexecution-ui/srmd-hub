import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  foldStock, outstandingReturnables, heldItemCount, type Movement, type StockRow,
  type ReturnableLine, type ReturnableRow, type Register, type Stage,
} from './core'
import type { RegisterSpec, RegisterFilter, RegisterRow } from './registers'
import { groupProjects, type ProjectOpt } from './core'
import { loadAliasMap, resolveAlias } from '@/lib/aliases'
export type { ProjectOpt }


/**
 * Reads for the Stores section. SELECT only — every write lives in actions.ts
 * so there is one place to look for anything that changes the ledger.
 */

export interface ListRow {
  id: string
  kind: 'entity' | 'delivery_mode' | 'item_category' | 'discipline' | 'location'
  name: string
  code: string | null
  parentId: string | null
  parentName?: string | null
  projectId: string | null
  in4CompanyId: number | null
  displayOrder: number
  isActive: boolean
}

export interface ItemRow {
  id: string
  name: string
  unit: string
  in4MaterialId: number | null
  disciplineId: string | null
  lastRate: number | null
  isActive: boolean
}

export interface EntryRow {
  id: string
  no: string
  direction: 'in' | 'out'
  register: Register
  stage: Stage
  entryAt: string
  entryDate: string
  projectId: string | null
  projectName: string | null
  partyName: string | null
  vehicleNo: string | null
  driverName: string | null
  poWoNo: string | null
  locationId: string | null
  locationName: string | null
  lineCount: number
  totalQty: number
  createdByName: string | null
  linkedNo: string | null
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0

/** Every master row, both levels of location, in display order. */
export async function loadLists(): Promise<ListRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_lists')
    .select('id, kind, name, code, parent_id, project_id, in4_company_id, display_order, is_active')
    .order('kind').order('display_order').order('name')

  const rows = (data ?? []).map(r => ({
    id: r.id as string,
    kind: r.kind as ListRow['kind'],
    name: (r.name as string) ?? '',
    code: (r.code as string | null) ?? null,
    parentId: (r.parent_id as string | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    in4CompanyId: (r.in4_company_id as number | null) ?? null,
    displayOrder: num(r.display_order),
    isActive: r.is_active !== false,
  }))
  const byId = new Map(rows.map(r => [r.id, r.name]))
  return rows.map(r => ({ ...r, parentName: r.parentId ? byId.get(r.parentId) ?? null : null }))
}

export const listsOf = (rows: readonly ListRow[], kind: ListRow['kind']) =>
  rows.filter(r => r.kind === kind)

/** Storage locations as "Site → Spot", which is how people say them. */
export function locationLabel(rows: readonly ListRow[], id: string | null): string | null {
  if (!id) return null
  const row = rows.find(r => r.id === id)
  if (!row) return null
  return row.parentName ? `${row.parentName} → ${row.name}` : row.name
}

/** Only the spots material can actually sit in — a site with children is a
 *  heading, not a place, so offering it would split the same stock two ways. */
export function storableLocations(rows: readonly ListRow[]): ListRow[] {
  const locations = listsOf(rows, 'location').filter(r => r.isActive)
  const parents = new Set(locations.map(r => r.parentId).filter(Boolean) as string[])
  return locations.filter(r => !parents.has(r.id))
}

export async function loadItems(): Promise<ItemRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_items')
    .select('id, name, unit, in4_material_id, discipline_id, last_rate, is_active')
    .order('name')
  return (data ?? []).map(r => ({
    id: r.id as string,
    name: (r.name as string) ?? '',
    unit: (r.unit as string) ?? 'Nos',
    in4MaterialId: (r.in4_material_id as number | null) ?? null,
    disciplineId: (r.discipline_id as string | null) ?? null,
    lastRate: r.last_rate == null ? null : num(r.last_rate),
    isActive: r.is_active !== false,
  }))
}

/** The whole ledger, folded. Small today; when it is not, this gains a date
 *  window rather than a stored total — the fold is the point. */
export async function loadStock(asOn?: string): Promise<StockRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_movements')
    .select('item_id, location_id, qty, kind, rate, moved_at')
    .order('moved_at')
  const movements: Movement[] = (data ?? []).map(r => ({
    itemId: r.item_id as string,
    locationId: (r.location_id as string | null) ?? null,
    qty: num(r.qty),
    kind: r.kind as Movement['kind'],
    rate: r.rate == null ? null : num(r.rate),
    movedAt: r.moved_at as string,
  }))
  return foldStock(movements, asOn)
}

export async function loadEntries(opts: {
  projectId?: string | null
  stage?: Stage | null
  direction?: 'in' | 'out' | null
  limit?: number
} = {}): Promise<EntryRow[]> {
  const supabase = await createClient()
  let q = supabase
    .from('mio_entries')
    .select(`id, no, direction, register, stage, entry_at, entry_date, project_id, party_name,
             vehicle_no, driver_name, po_wo_no, location_id, created_by,
             projects:project_id ( name ),
             creator:created_by ( full_name ),
             linked:linked_entry_id ( no ),
             mio_entry_lines ( id, qty )`)
    .order('entry_at', { ascending: false })
    .limit(opts.limit ?? 200)

  if (opts.projectId) q = q.eq('project_id', opts.projectId)
  if (opts.stage) q = q.eq('stage', opts.stage)
  if (opts.direction) q = q.eq('direction', opts.direction)

  const { data } = await q
  const lists = await loadLists()

  return (data ?? []).map(r => {
    const lines = (r.mio_entry_lines as Array<{ id: string; qty: number }> | null) ?? []
    const proj = r.projects as { name?: string } | null
    const creator = r.creator as { full_name?: string } | null
    const linked = r.linked as { no?: string } | null
    return {
      id: r.id as string,
      no: (r.no as string) ?? '',
      direction: r.direction as 'in' | 'out',
      register: r.register as Register,
      stage: r.stage as Stage,
      entryAt: r.entry_at as string,
      entryDate: r.entry_date as string,
      projectId: (r.project_id as string | null) ?? null,
      projectName: proj?.name ?? null,
      partyName: (r.party_name as string | null) ?? null,
      vehicleNo: (r.vehicle_no as string | null) ?? null,
      driverName: (r.driver_name as string | null) ?? null,
      poWoNo: (r.po_wo_no as string | null) ?? null,
      locationId: (r.location_id as string | null) ?? null,
      locationName: locationLabel(lists, (r.location_id as string | null) ?? null),
      lineCount: lines.length,
      totalQty: lines.reduce((s, l) => s + num(l.qty), 0),
      createdByName: creator?.full_name ?? null,
      linkedNo: linked?.no ?? null,
    }
  })
}

export interface Signature {
  /** Who signed — the typed name where there is one, else the account. */
  who: string | null
  at: string | null
}

export interface EntryDetail extends EntryRow {
  entityId: string | null
  deliveryModeId: string | null
  itemCategoryId: string | null
  driverMobile: string | null
  driverLicence: string | null
  remarks: string | null
  securityBy: string | null
  handedOverParty: string | null
  handedOverTo: string | null
  inchargeName: string | null
  /** The three signature points the mind map asks for. Captured since the
   *  section shipped and, until now, displayed nowhere — which is the same as
   *  not capturing them. */
  signatures: { security: Signature; incharge: Signature; receiver: Signature }
  lines: Array<{ id: string; itemId: string; itemName: string; unit: string; qty: number; rate: number | null; amount: number | null; returnable: boolean }>
  photos: Array<{ id: string; kind: string; path: string }>
  edits: Array<{ id: string; field: string; oldValue: string | null; newValue: string | null; changedAt: string; changedBy: string | null }>
}

export async function loadEntry(id: string): Promise<EntryDetail | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_entries')
    .select(`*, projects:project_id ( name ), creator:created_by ( full_name ), linked:linked_entry_id ( no ),
             securitySigner:security_signed_by ( full_name ),
             inchargeSigner:incharge_signed_by ( full_name ),
             receiverSigner:receiver_signed_by ( full_name ),
             mio_entry_lines ( id, item_id, unit, qty, rate, amount, returnable, mio_items ( name ) ),
             mio_photos ( id, kind, path )`)
    .eq('id', id)
    .maybeSingle()
  if (!data) return null

  const { data: edits } = await supabase
    .from('mio_edits')
    .select('id, field, old_value, new_value, changed_at, profiles:changed_by ( full_name )')
    .eq('table_name', 'mio_entries').eq('row_id', id)
    .order('changed_at', { ascending: false })

  const lists = await loadLists()
  const rawLines = (data.mio_entry_lines as Array<Record<string, unknown>> | null) ?? []
  const proj = data.projects as { name?: string } | null
  const creator = data.creator as { full_name?: string } | null
  const linked = data.linked as { no?: string } | null

  return {
    id: data.id as string,
    no: (data.no as string) ?? '',
    direction: data.direction as 'in' | 'out',
    register: data.register as Register,
    stage: data.stage as Stage,
    entryAt: data.entry_at as string,
    entryDate: data.entry_date as string,
    projectId: (data.project_id as string | null) ?? null,
    projectName: proj?.name ?? null,
    partyName: (data.party_name as string | null) ?? null,
    vehicleNo: (data.vehicle_no as string | null) ?? null,
    driverName: (data.driver_name as string | null) ?? null,
    poWoNo: (data.po_wo_no as string | null) ?? null,
    locationId: (data.location_id as string | null) ?? null,
    locationName: locationLabel(lists, (data.location_id as string | null) ?? null),
    lineCount: rawLines.length,
    totalQty: rawLines.reduce((s, l) => s + num(l.qty), 0),
    createdByName: creator?.full_name ?? null,
    linkedNo: linked?.no ?? null,
    entityId: (data.entity_id as string | null) ?? null,
    deliveryModeId: (data.delivery_mode_id as string | null) ?? null,
    itemCategoryId: (data.item_category_id as string | null) ?? null,
    driverMobile: (data.driver_mobile as string | null) ?? null,
    driverLicence: (data.driver_licence as string | null) ?? null,
    remarks: (data.remarks as string | null) ?? null,
    securityBy: (data.security_by as string | null) ?? null,
    handedOverParty: (data.handed_over_party as string | null) ?? null,
    handedOverTo: (data.handed_over_to as string | null) ?? null,
    inchargeName: (data.incharge_name as string | null) ?? null,
    signatures: {
      security: {
        who: (data.security_by as string | null)
          ?? ((data.securitySigner as { full_name?: string } | null)?.full_name ?? null),
        at: (data.security_signed_at as string | null) ?? null,
      },
      incharge: {
        who: (data.incharge_name as string | null)
          ?? ((data.inchargeSigner as { full_name?: string } | null)?.full_name ?? null),
        at: (data.incharge_signed_at as string | null) ?? null,
      },
      receiver: {
        who: (data.handed_over_to as string | null)
          ?? ((data.receiverSigner as { full_name?: string } | null)?.full_name ?? null),
        at: (data.receiver_signed_at as string | null) ?? null,
      },
    },
    lines: rawLines.map(l => ({
      id: l.id as string,
      itemId: l.item_id as string,
      itemName: ((l.mio_items as { name?: string } | null)?.name) ?? '—',
      unit: (l.unit as string) ?? '',
      qty: num(l.qty),
      rate: l.rate == null ? null : num(l.rate),
      amount: l.amount == null ? null : num(l.amount),
      returnable: l.returnable === true,
    })),
    photos: ((data.mio_photos as Array<Record<string, unknown>> | null) ?? [])
      .map(p => ({ id: p.id as string, kind: p.kind as string, path: p.path as string })),
    edits: (edits ?? []).map(e => ({
      id: e.id as string,
      field: e.field as string,
      oldValue: (e.old_value as string | null) ?? null,
      newValue: (e.new_value as string | null) ?? null,
      changedAt: e.changed_at as string,
      changedBy: ((e.profiles as { full_name?: string } | null)?.full_name) ?? null,
    })),
  }
}

export interface RequestRow {
  id: string
  no: string
  projectId: string
  projectName: string | null
  fromProjectName: string | null
  status: 'pending' | 'approved' | 'rejected' | 'issued' | 'closed'
  neededBy: string | null
  remarks: string | null
  raisedByName: string | null
  raisedAt: string
  decidedByName: string | null
  decidedAt: string | null
  decisionNote: string | null
  lines: Array<{ id: string; itemId: string; itemName: string; unit: string; qty: number; issuedQty: number; returnable: boolean }>
}

export async function loadRequests(opts: { projectId?: string | null; status?: string | null } = {}): Promise<RequestRow[]> {
  const supabase = await createClient()
  let q = supabase
    .from('mio_requests')
    .select(`id, no, project_id, status, needed_by, remarks, raised_at, decided_at, decision_note,
             projects:project_id ( name ), from_project:from_project_id ( name ),
             raiser:raised_by ( full_name ), decider:decided_by ( full_name ),
             mio_request_lines ( id, item_id, unit, qty, issued_qty, returnable, mio_items ( name ) )`)
    .order('raised_at', { ascending: false })
    .limit(200)
  if (opts.projectId) q = q.eq('project_id', opts.projectId)
  if (opts.status) q = q.eq('status', opts.status)

  const { data } = await q
  return (data ?? []).map(r => ({
    id: r.id as string,
    no: (r.no as string) ?? '',
    projectId: r.project_id as string,
    projectName: ((r.projects as { name?: string } | null)?.name) ?? null,
    fromProjectName: ((r.from_project as { name?: string } | null)?.name) ?? null,
    status: r.status as RequestRow['status'],
    neededBy: (r.needed_by as string | null) ?? null,
    remarks: (r.remarks as string | null) ?? null,
    raisedByName: ((r.raiser as { full_name?: string } | null)?.full_name) ?? null,
    raisedAt: r.raised_at as string,
    decidedByName: ((r.decider as { full_name?: string } | null)?.full_name) ?? null,
    decidedAt: (r.decided_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    lines: ((r.mio_request_lines as Array<Record<string, unknown>> | null) ?? []).map(l => ({
      id: l.id as string,
      itemId: l.item_id as string,
      itemName: ((l.mio_items as { name?: string } | null)?.name) ?? '—',
      unit: (l.unit as string) ?? '',
      qty: num(l.qty),
      issuedQty: num(l.issued_qty),
      returnable: l.returnable === true,
    })),
  }))
}

/**
 * What still owes its way back.
 *
 * A returnable line is created by an entry, and cleared by OUT entries linked
 * back to it — so the debt and its settlement are the same register read
 * twice, not a second list someone has to keep in step.
 */
export async function loadReturnables(projectId?: string | null): Promise<ReturnableRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_entry_lines')
    .select(`id, item_id, unit, qty, returnable, returns_line_id,
             mio_items ( name ),
             mio_entries!inner ( id, no, direction, register, stage, entry_at, project_id, party_name,
                                 linked_entry_id, projects:project_id ( name ) )`)
    .eq('returnable', true)
    .limit(2000)

  // An embedded to-one relation comes back as an object, but the generated
  // types describe `!inner` as an array. Normalise once rather than casting at
  // every use, so a shape change shows up in one place.
  const one = (v: unknown): Record<string, unknown> =>
    (Array.isArray(v) ? v[0] : v) as Record<string, unknown>

  const rows = (data ?? []).filter(r => {
    const e = one(r.mio_entries)
    return e && e.stage !== 'void'
  })

  // Anything returned so far, keyed by the LINE it answers.
  //
  // Per line, not per entry: one gate entry can bring in props and shuttering
  // both marked returnable, and netting a partial return of the props against
  // the entry would quietly settle the shuttering too. `returns_line_id` makes
  // it exact. Returns recorded before that column existed carry null and are
  // still matched at entry level, so nothing already booked is lost.
  const returnedByLine = new Map<string, number>()
  const returnedByEntry = new Map<string, number>()
  for (const r of rows) {
    const e = one(r.mio_entries)
    if (e.direction !== 'out') continue
    const line = (r.returns_line_id as string | null) ?? null
    if (line) { returnedByLine.set(line, (returnedByLine.get(line) ?? 0) + num(r.qty)); continue }
    const target = e.linked_entry_id as string | null
    if (target) returnedByEntry.set(target, (returnedByEntry.get(target) ?? 0) + num(r.qty))
  }
  // An entry-level return with no line is spread over that entry's lines in
  // order, so an old record still nets to the right total.
  const spread = new Map<string, number>(returnedByEntry)

  const lines: ReturnableLine[] = rows
    .filter(r => one(r.mio_entries).direction === 'in')
    .filter(r => !projectId || one(r.mio_entries).project_id === projectId)
    .map(r => {
      const e = one(r.mio_entries)
      const proj = (one(e.projects) as { name?: string } | null)?.name ?? 'Unassigned'
      const lineId = r.id as string
      const qty = num(r.qty)
      let returned = returnedByLine.get(lineId) ?? 0
      // Take what is left of any entry-level (pre-column) return.
      const pool = spread.get(e.id as string) ?? 0
      if (pool > 0) {
        const take = Math.min(pool, Math.max(0, qty - returned))
        returned += take
        spread.set(e.id as string, pool - take)
      }
      return {
        lineId,
        entryId: e.id as string,
        entryNo: (e.no as string) ?? '',
        itemId: r.item_id as string,
        itemName: ((r.mio_items as { name?: string } | null)?.name) ?? '—',
        unit: (r.unit as string) ?? '',
        qty,
        heldBy: proj,
        owedTo: e.register === 'vendor'
          ? `${(e.party_name as string) ?? 'Vendor'} (vendor)`
          : 'CT Warehouse',
        since: e.entry_at as string,
        returned,
      }
    })

  return outstandingReturnables(lines)
}

/**
 * The shops that have delivered here lately, most-used first.
 *
 * Shown as tap-chips above the "who brought it" field. The same six names come
 * back week after week, and tapping one beats spelling it — which matters most
 * for the person we are asking to type the least.
 */
export async function loadRecentParties(limit = 6): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_entries')
    .select('party_name')
    .not('party_name', 'is', null)
    .neq('stage', 'void')
    .order('entry_at', { ascending: false })
    .limit(120)

  const count = new Map<string, number>()
  for (const r of data ?? []) {
    const name = (r.party_name as string | null)?.trim()
    if (name) count.set(name, (count.get(name) ?? 0) + 1)
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => n)
}

/* ── Orders (IN4 purchase orders and work orders) ───────────────────────── */

/**
 * IN4 keys its party list by KIND AND ID TOGETHER: 423 contractors and 180
 * suppliers, and every one of the 180 supplier ids is also a contractor id.
 * Looking one up by id alone returns two rows where one is expected, so the
 * lookup errored and the supplier name came back null — on all 1,451 orders,
 * since the first day this screen existed. Never drop the kind.
 */
const SUPPLIER = 'supplier'
const CONTRACTOR = 'contractor'

type Sb = Awaited<ReturnType<typeof createClient>>

async function partyName(supabase: Sb, kind: string, id: number | null): Promise<string | null> {
  if (id == null) return null
  const { data } = await supabase
    .from('in4_parties').select('name').eq('kind', kind).eq('id', id).maybeSingle()
  return ((data as { name?: string } | null)?.name as string | null) ?? null
}

async function partyNames(supabase: Sb, kind: string, ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map()
  const { data } = await supabase
    .from('in4_parties').select('id, name').eq('kind', kind).in('id', ids)
  return new Map((data ?? []).map(r => [r.id as number, (r.name as string) ?? '']))
}

export type OrderKind = 'po' | 'wo'

/** One row in the storekeeper's order picker. */
export interface OrderOption {
  /** Stable across both kinds — "po:1234". */
  key: string
  kind: OrderKind
  no: string
  party: string | null
  /** IN4's own project name, not a hub project. */
  projectName: string | null
  date: string | null
  value: number | null
  /** A purchase order with something still to come. Work orders carry no
   *  receiving status in the mirror, so this is always false for them. */
  open: boolean
  /** Lines not yet fully received. null for a work order, which has none. */
  linesDue: number | null
}

/**
 * Search both order books for the picker.
 *
 * The serial is what people say out loud — "PO ninety-four" — so a bare number
 * matches anywhere in the number, tail included. Open purchase orders sort
 * first: they are the only ones a lorry could be delivering against today.
 *
 * With no query at all the list is exactly the open purchase orders (89 of the
 * 1,451 today) plus the newest few work orders, because that is the honest
 * answer to "what could be arriving now".
 */
export async function searchOrders(query: string, limit = 40): Promise<OrderOption[]> {
  const supabase = await createClient()
  const q = query.trim()
  // With no query the list IS the answer — all 89 open orders, not the first
  // 40 of them, because a storekeeper scrolling to the end of a capped list
  // has no way to know the one they want was cut off.
  const poLimit = q ? limit : 200

  let poQ = supabase
    .from('in4_purchase_orders')
    .select('po_id, po_no, po_dt, supplier_id, project_id, po_value, status, grn_status')
    .eq('status', 'Approved')
  poQ = q ? poQ.ilike('po_no', `%${q}%`) : poQ.in('grn_status', ['No', 'Partial'])

  let woQ = supabase
    .from('in4_work_orders')
    .select('wo_id, display_no, creation_dt, contractor_id, subproject_id, wo_value')
    .eq('status_name', 'Approved')
  if (q) woQ = woQ.ilike('display_no', `%${q}%`)

  const [{ data: pos }, { data: wos }] = await Promise.all([
    poQ.order('po_dt', { ascending: false }).limit(poLimit),
    woQ.order('creation_dt', { ascending: false }).limit(q ? limit : 10),
  ])

  const projectIds = [...new Set((pos ?? []).map(p => p.project_id as number).filter(Boolean))]
  const subIds = [...new Set((wos ?? []).map(w => w.subproject_id as number).filter(Boolean))]
  const [suppliers, contractors, { data: projects }, { data: subs }] = await Promise.all([
    partyNames(supabase, SUPPLIER, [...new Set((pos ?? []).map(p => p.supplier_id as number).filter(Boolean))]),
    partyNames(supabase, CONTRACTOR, [...new Set((wos ?? []).map(w => w.contractor_id as number).filter(Boolean))]),
    projectIds.length
      ? supabase.from('in4_projects').select('id, name').in('id', projectIds)
      : Promise.resolve({ data: [] as Array<{ id: number; name: string }> }),
    subIds.length
      ? supabase.from('in4_subprojects').select('id, name').in('id', subIds)
      : Promise.resolve({ data: [] as Array<{ id: number; name: string }> }),
  ])
  const projectById = new Map((projects ?? []).map(r => [r.id as number, (r.name as string) ?? '']))
  const subById = new Map((subs ?? []).map(r => [r.id as number, (r.name as string) ?? '']))

  // How many lines are still due, in one query rather than one per order.
  const poIds = (pos ?? []).map(p => p.po_id as number)
  const dueByPo = new Map<number, number>()
  if (poIds.length) {
    const { data: items } = await supabase
      .from('in4_po_items').select('po_id, base_po_qty, grn_qty').in('po_id', poIds)
    for (const i of items ?? []) {
      if (num(i.grn_qty) < num(i.base_po_qty)) {
        const pid = i.po_id as number
        dueByPo.set(pid, (dueByPo.get(pid) ?? 0) + 1)
      }
    }
  }

  const rows: OrderOption[] = [
    ...(pos ?? []).map(p => ({
      key: `po:${p.po_id}`,
      kind: 'po' as const,
      no: (p.po_no as string) ?? '',
      party: suppliers.get(p.supplier_id as number) ?? null,
      projectName: projectById.get(p.project_id as number) ?? null,
      date: (p.po_dt as string | null) ?? null,
      value: p.po_value == null ? null : num(p.po_value),
      open: p.grn_status === 'No' || p.grn_status === 'Partial',
      linesDue: dueByPo.get(p.po_id as number) ?? 0,
    })),
    ...(wos ?? []).map(w => ({
      key: `wo:${w.wo_id}`,
      kind: 'wo' as const,
      no: (w.display_no as string) ?? `WO ${w.wo_id}`,
      party: contractors.get(w.contractor_id as number) ?? null,
      projectName: subById.get(w.subproject_id as number) ?? null,
      date: (w.creation_dt as string | null) ?? null,
      value: w.wo_value == null ? null : num(w.wo_value),
      open: false,
      linesDue: null,
    })),
  ]

  // Open purchase orders first, then newest.
  return rows.sort((a, b) =>
    Number(b.open) - Number(a.open) || (b.date ?? '').localeCompare(a.date ?? ''))
}

/** IN4's PO lines for one order — what was ordered and how much has landed
 *  already, so the storekeeper ticks rather than types. */
export interface PoLine {
  in4PoItemId: number
  materialId: number
  name: string
  unit: string
  ordered: number
  alreadyIn: number
  rate: number
}

export interface OrderDetail {
  kind: OrderKind
  no: string
  party: string | null
  /** IN4's own project name. */
  projectName: string | null
  /** The hub project it resolves to, or null with the reason in projectWhy. */
  projectId: string | null
  projectWhy: string | null
  date: string | null
  value: number | null
  lines: PoLine[]
  /** Why there are no lines, when there are none to have. */
  linesWhy: string | null
}


/**
 * Everything one order can tell the storekeeper.
 *
 * The hub project is resolved through project_aliases — exact match on the
 * normalised name, never fuzzy (lib/aliases.ts). Where IN4's project has no
 * alias, projectId stays null and projectWhy says so, because a wrong project
 * booked silently is worse than a blank one: nobody goes looking for it.
 */
export async function loadOrder(key: string): Promise<OrderDetail | null> {
  const [kind, rawId] = key.split(':')
  const id = Number(rawId)
  if ((kind !== 'po' && kind !== 'wo') || !Number.isFinite(id)) return null
  const supabase = await createClient()

  if (kind === 'wo') {
    const { data: wo } = await supabase
      .from('in4_work_orders')
      .select('wo_id, display_no, creation_dt, contractor_id, subproject_id, wo_value')
      .eq('wo_id', id).maybeSingle()
    if (!wo) return null
    const [party, { data: sub }] = await Promise.all([
      partyName(supabase, CONTRACTOR, (wo.contractor_id as number | null) ?? null),
      wo.subproject_id
        ? supabase.from('in4_subprojects').select('name').eq('id', wo.subproject_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])
    const projectName = ((sub as { name?: string } | null)?.name as string | null) ?? null
    const no = (wo.display_no as string) ?? `WO ${wo.wo_id}`
    return {
      kind, no, party, projectName,
      ...(await resolveHubProject(supabase, projectName)),
      date: (wo.creation_dt as string | null) ?? null,
      value: wo.wo_value == null ? null : num(wo.wo_value),
      lines: [],
      // in4_wo_boq_items carries a work description and a uom, never a
      // material id, so its lines cannot become stock lines. Saying so beats
      // an empty list the storekeeper reads as a failure.
      linesWhy: 'A work order lists work, not materials — add what actually arrived.',
    }
  }

  const { data: po } = await supabase
    .from('in4_purchase_orders')
    .select('po_id, po_no, po_dt, project_id, supplier_id, po_value')
    .eq('po_id', id).maybeSingle()
  if (!po) return null

  const [{ data: items }, party, { data: project }] = await Promise.all([
    supabase.from('in4_po_items')
      .select('item_id, material_id, uom_id, base_po_qty, grn_qty, net_rate')
      .eq('po_id', po.po_id),
    partyName(supabase, SUPPLIER, (po.supplier_id as number | null) ?? null),
    po.project_id
      ? supabase.from('in4_projects').select('name').eq('id', po.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const materialIds = [...new Set((items ?? []).map(i => i.material_id as number).filter(Boolean))]
  const { data: mats } = materialIds.length
    ? await supabase.from('in4_materials').select('id, name, uom').in('id', materialIds)
    : { data: [] as Array<{ id: number; name: string; uom: string }> }
  const byMat = new Map((mats ?? []).map(m => [m.id as number, m]))
  const projectName = ((project as { name?: string } | null)?.name as string | null) ?? null
  const no = (po.po_no as string) ?? ''

  return {
    kind, no, party, projectName,
    ...(await resolveHubProject(supabase, projectName)),
    date: (po.po_dt as string | null) ?? null,
    value: po.po_value == null ? null : num(po.po_value),
    lines: (items ?? []).map(i => {
      const m = byMat.get(i.material_id as number)
      return {
        in4PoItemId: i.item_id as number,
        materialId: i.material_id as number,
        name: (m?.name as string) ?? `Material ${i.material_id}`,
        unit: (m?.uom as string) ?? 'Nos',
        ordered: num(i.base_po_qty),
        alreadyIn: num(i.grn_qty),
        rate: num(i.net_rate),
      }
    }),
    linesWhy: (items ?? []).length === 0 ? 'This order has no item lines in IN4.' : null,
  }
}

/** IN4 project name → hub project, through the alias table only. */
async function resolveHubProject(
  supabase: Sb,
  projectName: string | null,
): Promise<{ projectId: string | null; projectWhy: string | null }> {
  if (!projectName) return { projectId: null, projectWhy: 'The order names no project in IN4.' }
  try {
    const map = await loadAliasMap(supabase, 'in4')
    const hit = resolveAlias(map, projectName)
    if (hit.kind === 'project') return { projectId: hit.projectId, projectWhy: null }
    if (hit.kind === 'not-ours') {
      return { projectId: null, projectWhy: `IN4 calls this "${projectName}", which is marked as not ours.` }
    }
    return {
      projectId: null,
      projectWhy: `IN4 calls this "${projectName}" — no hub project is mapped to that name yet.`,
    }
  } catch {
    return { projectId: null, projectWhy: `Could not check what "${projectName}" maps to.` }
  }
}

export async function loadCounts(projectId?: string | null): Promise<{
  toComplete: number; pendingRequests: number; returnablesOut: number; itemsHeld: number
}> {
  const supabase = await createClient()
  const scoped = <T extends { eq: (c: string, v: string) => T }>(q: T) =>
    projectId ? q.eq('project_id', projectId) : q

  const [gate, reqs, returnables, stock] = await Promise.all([
    scoped(supabase.from('mio_entries').select('id', { count: 'exact', head: true }).eq('stage', 'gate') as never),
    scoped(supabase.from('mio_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') as never),
    loadReturnables(projectId ?? null),
    loadStock(),
  ])
  return {
    toComplete: (gate as { count: number | null }).count ?? 0,
    pendingRequests: (reqs as { count: number | null }).count ?? 0,
    returnablesOut: returnables.length,
    itemsHeld: heldItemCount(stock),
  }
}

/* ── The four registers ─────────────────────────────────────────────────── */

/**
 * One register's rows: the gate entries of one direction and one register,
 * read line by line, filtered the way the mind map asks —
 * "Select Period · Select Vendor · Select Project · Select Disciplines".
 *
 * The SAME entries every other screen reads, so a register can never quote a
 * quantity the gate does not have.
 */
export async function loadRegister(
  spec: RegisterSpec, f: RegisterFilter = {},
): Promise<RegisterRow[]> {
  const supabase = await createClient()
  let q = supabase
    .from('mio_entry_lines')
    .select(`id, item_id, unit, qty, rate, amount,
             mio_items ( name, discipline_id ),
             mio_entries!inner ( id, no, direction, register, stage, entry_at, entry_date,
                                 party_name, po_wo_no, remarks, location_id, project_id, entity_id,
                                 projects:project_id ( name ),
                                 entity:entity_id ( name, code ),
                                 linked:linked_entry_id ( no ) )`)
    .eq('mio_entries.direction', spec.direction)
    .eq('mio_entries.register', spec.register)
    .neq('mio_entries.stage', 'void')
    .limit(5000)

  if (f.from) q = q.gte('mio_entries.entry_date', f.from)
  if (f.to) q = q.lte('mio_entries.entry_date', f.to)
  if (f.projectId) q = q.eq('mio_entries.project_id', f.projectId)
  if (f.party) q = q.ilike('mio_entries.party_name', `%${f.party}%`)

  const [{ data }, lists] = await Promise.all([q, loadLists()])
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown>
  const disciplineName = new Map(
    listsOf(lists, 'discipline').map(d => [d.id, d.name]),
  )

  const rows: RegisterRow[] = (data ?? []).map(r => {
    const e = one(r.mio_entries)
    const item = one(r.mio_items) as { name?: string; discipline_id?: string | null } | null
    const ent = one(e.entity) as { name?: string; code?: string } | null
    return {
      entryId: e.id as string,
      entryNo: (e.no as string) ?? '',
      linkedNo: ((one(e.linked) as { no?: string } | null)?.no) ?? null,
      day: e.entry_date as string,
      party: (e.party_name as string | null) ?? null,
      projectName: ((one(e.projects) as { name?: string } | null)?.name) ?? null,
      entity: ent?.code ?? ent?.name ?? null,
      place: locationLabel(lists, (e.location_id as string | null) ?? null),
      itemId: r.item_id as string,
      itemName: item?.name ?? '—',
      discipline: item?.discipline_id ? disciplineName.get(item.discipline_id) ?? null : null,
      unit: (r.unit as string) ?? '',
      qty: num(r.qty),
      rate: r.rate == null ? null : num(r.rate),
      amount: r.amount == null ? null : num(r.amount),
      poWoNo: (e.po_wo_no as string | null) ?? null,
      remarks: (e.remarks as string | null) ?? null,
    }
  })

  // Discipline lives on the ITEM, not the entry, so it cannot be a database
  // filter without a join Supabase will not give us here. Filtered after —
  // correct either way, and the row counts are small enough that it is free.
  const wanted = f.disciplineId ? disciplineName.get(f.disciplineId) ?? null : null
  const filtered = wanted ? rows.filter(r => r.discipline === wanted) : rows

  return filtered.sort((a, b) => b.day.localeCompare(a.day) || a.itemName.localeCompare(b.itemName))
}

/** The vendors that appear on the gate, for the register's party picker. */
export async function loadRegisterParties(): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_entries').select('party_name').not('party_name', 'is', null).neq('stage', 'void').limit(2000)
  return [...new Set((data ?? []).map(r => (r.party_name as string).trim()).filter(Boolean))].sort()
}

/* ── Project picker ─────────────────────────────────────────────────────── */

/** Every project, ordered and grouped for a picker. See groupProjects. */

/* ── Project picker ─────────────────────────────────────────────────────── */

/** Every project, ordered and grouped for a picker. See groupProjects. */
export async function loadProjectOptions(): Promise<ProjectOpt[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('projects')
    .select('id, name, parent_project_id')
    .order('name')

  return groupProjects((data ?? []).map(r => ({
    id: r.id as string,
    name: ((r.name as string) ?? '').trim(),
    parentId: (r.parent_project_id as string | null) ?? null,
  })))
}

/**
 * The items this store has handled lately, newest first.
 *
 * Pinned to the top of the item picker. Most gate entries repeat last week's:
 * the same shop brings the same cable to the same store. 659 items in
 * alphabetical order buries that; ten rows at the top answers it.
 */
export async function loadRecentItemIds(limit = 10): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_entry_lines')
    .select('item_id, created_at')
    .order('created_at', { ascending: false })
    .limit(300)

  const seen: string[] = []
  for (const r of data ?? []) {
    const id = r.item_id as string | null
    if (id && !seen.includes(id)) seen.push(id)
    if (seen.length >= limit) break
  }
  return seen
}

/**
 * Where this store put things last, so the form can offer it rather than ask.
 *
 * Keyed by project, with a fallback for "wherever we last put anything". A
 * storekeeper works one site and puts material in the same two places every
 * week; making them answer that afresh every entry is asking them to retype
 * what the register already knows.
 *
 * Only completed entries count — a gate row has no location yet, and a voided
 * one is not a precedent.
 */
export async function loadLastLocations(): Promise<{
  byProject: Record<string, string>
  lastUsed: string | null
}> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_entries')
    .select('project_id, location_id, entry_at')
    .not('location_id', 'is', null)
    .neq('stage', 'void')
    .order('entry_at', { ascending: false })
    .limit(200)

  const byProject: Record<string, string> = {}
  let lastUsed: string | null = null
  for (const r of data ?? []) {
    const loc = r.location_id as string
    if (!lastUsed) lastUsed = loc
    const pid = r.project_id as string | null
    if (pid && !byProject[pid]) byProject[pid] = loc
  }
  return { byProject, lastUsed }
}
