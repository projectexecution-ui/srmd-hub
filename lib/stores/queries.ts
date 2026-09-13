import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  foldStock, outstandingReturnables, type Movement, type StockRow,
  type ReturnableLine, type ReturnableRow, type Register, type Stage,
} from './core'

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
  securitySignedAt: string | null
  receiverSignedAt: string | null
  inchargeSignedAt: string | null
  lines: Array<{ id: string; itemId: string; itemName: string; unit: string; qty: number; rate: number | null; amount: number | null; returnable: boolean }>
  photos: Array<{ id: string; kind: string; path: string }>
  edits: Array<{ id: string; field: string; oldValue: string | null; newValue: string | null; changedAt: string; changedBy: string | null }>
}

export async function loadEntry(id: string): Promise<EntryDetail | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_entries')
    .select(`*, projects:project_id ( name ), creator:created_by ( full_name ), linked:linked_entry_id ( no ),
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
    securitySignedAt: (data.security_signed_at as string | null) ?? null,
    receiverSignedAt: (data.receiver_signed_at as string | null) ?? null,
    inchargeSignedAt: (data.incharge_signed_at as string | null) ?? null,
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
    .select(`id, item_id, unit, qty, returnable,
             mio_items ( name ),
             mio_entries!inner ( id, no, direction, register, stage, entry_at, project_id, party_name,
                                 linked_entry_id, projects:project_id ( name ) )`)
    .eq('returnable', true)
    .limit(1000)

  // An embedded to-one relation comes back as an object, but the generated
  // types describe `!inner` as an array. Normalise once rather than casting at
  // every use, so a shape change shows up in one place.
  const one = (v: unknown): Record<string, unknown> =>
    (Array.isArray(v) ? v[0] : v) as Record<string, unknown>

  const rows = (data ?? []).filter(r => {
    const e = one(r.mio_entries)
    return e && e.stage !== 'void'
  })

  // Anything returned so far, keyed by the entry it answers.
  const returnedBy = new Map<string, number>()
  for (const r of rows) {
    const e = one(r.mio_entries)
    if (e.direction !== 'out') continue
    const target = e.linked_entry_id as string | null
    if (!target) continue
    returnedBy.set(target, (returnedBy.get(target) ?? 0) + num(r.qty))
  }

  const lines: ReturnableLine[] = rows
    .filter(r => one(r.mio_entries).direction === 'in')
    .filter(r => !projectId || one(r.mio_entries).project_id === projectId)
    .map(r => {
      const e = one(r.mio_entries)
      const proj = (one(e.projects) as { name?: string } | null)?.name ?? 'Unassigned'
      return {
        entryId: e.id as string,
        entryNo: (e.no as string) ?? '',
        itemId: r.item_id as string,
        itemName: ((r.mio_items as { name?: string } | null)?.name) ?? '—',
        unit: (r.unit as string) ?? '',
        qty: num(r.qty),
        heldBy: proj,
        owedTo: e.register === 'vendor'
          ? `${(e.party_name as string) ?? 'Vendor'} (vendor)`
          : 'CT Warehouse',
        since: e.entry_at as string,
        returned: returnedBy.get(e.id as string) ?? 0,
      }
    })

  return outstandingReturnables(lines)
}

/** IN4's PO lines for one PO number — what was ordered and how much has landed
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

export async function loadPoLines(poNo: string): Promise<{ poNo: string; project: string | null; supplier: string | null; lines: PoLine[] } | null> {
  if (!poNo.trim()) return null
  const supabase = await createClient()
  const { data: po } = await supabase
    .from('in4_purchase_orders')
    .select('po_id, po_no, project_id, supplier_id')
    .ilike('po_no', poNo.trim())
    .maybeSingle()
  if (!po) return null

  const { data: items } = await supabase
    .from('in4_po_items')
    .select('item_id, material_id, uom_id, base_po_qty, grn_qty, net_rate')
    .eq('po_id', po.po_id)
  if (!items?.length) return { poNo: po.po_no as string, project: null, supplier: null, lines: [] }

  const materialIds = [...new Set(items.map(i => i.material_id as number).filter(Boolean))]
  const [{ data: mats }, { data: party }] = await Promise.all([
    supabase.from('in4_materials').select('id, name, uom').in('id', materialIds),
    po.supplier_id ? supabase.from('in4_parties').select('name').eq('id', po.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const byMat = new Map((mats ?? []).map(m => [m.id as number, m]))

  return {
    poNo: po.po_no as string,
    project: null,
    supplier: (party as { name?: string } | null)?.name ?? null,
    lines: items.map(i => {
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
  }
}

/** The counts the landing tiles show — one query each, all in parallel. */
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
    itemsHeld: stock.filter(r => r.qty > 0).length,
  }
}
