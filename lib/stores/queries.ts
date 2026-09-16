import 'server-only'
import { createClient } from '@/lib/supabase/server'
import {
  foldStock, outstandingReturnables, heldItemCount, RETURNABLES_ON, type Movement, type StockRow,
  type ReturnableLine, type ReturnableRow, type Register, type Stage,
} from './core'
import type { RegisterSpec, RegisterFilter, RegisterRow } from './registers'
import {
  groupProjects, isServiceScope, approversForRequest, type ProjectOpt, type ApproverKey,
} from './core'
import { duplicateNameGroups, type HealthInput, type ItemMove } from './desk'
import { loadAliasMap, resolveAlias } from '@/lib/aliases'
export type { ProjectOpt }


/**
 * Reads for the Stores section. SELECT only — every write lives in actions.ts
 * so there is one place to look for anything that changes the ledger.
 */

export interface ListRow {
  id: string
  kind: 'entity' | 'delivery_mode' | 'item_category' | 'discipline' | 'location' | 'unit'
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
  /** IN4 supplier id, when the gate picked one. */
  in4PartyId: number | null
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

/** PostgREST hands an embedded row back as an object or a one-element array
 *  depending on how it inferred the relationship. Two functions below already
 *  declare their own copy of this; those shadow it harmlessly. */
const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as Record<string, unknown> | null

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
             vehicle_no, driver_name, po_wo_no, location_id, created_by, in4_party_id,
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
      in4PartyId: (r.in4_party_id as number | null) ?? null,
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
   *  not capturing them.
   *
   *  WHICH of them apply depends on the direction, and the screen decides —
   *  see signaturesFor. An IN has no receiver: the person who received the
   *  material IS the storekeeper who counted it in. */
  signatures: { security: Signature; incharge: Signature; receiver: Signature }
  /** Who finished the entry, and when. On an issue this is the storekeeper who
   *  handed the material out — the one act on an OUT that nothing else
   *  records, because issueRequest stamps no signature column. */
  completedBy: string | null
  completedAt: string | null
  lines: Array<{ id: string; itemId: string; itemName: string; unit: string; qty: number; rate: number | null; amount: number | null; returnable: boolean }>
  /** A signed address, or null when signing failed — the strip then says
   *  a photograph exists and could not be fetched, rather than showing a
   *  broken picture. */
  photos: Array<{ id: string; kind: string; path: string; url: string | null }>
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
             completer:completed_by ( full_name ),
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

  /**
   * The photographs, signed so they can actually be looked at.
   *
   * `mio-photos` is a PRIVATE bucket, so a stored path is not a web address —
   * which is why every photograph taken since the camera was wired had been
   * recorded and then shown on no screen at all. An hour is long enough to
   * read an entry and short enough that a copied link is not a way around the
   * bucket being private.
   */
  const paths = ((data.mio_photos as Array<Record<string, unknown>> | null) ?? [])
    .map(p => p.path as string)
  const signed = new Map<string, string>()
  if (paths.length) {
    const { data: urls } = await supabase.storage.from('mio-photos').createSignedUrls(paths, 3600)
    for (const u of urls ?? []) {
      if (u.path && u.signedUrl) signed.set(u.path, u.signedUrl)
    }
  }

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
    in4PartyId: (data.in4_party_id as number | null) ?? null,
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
    completedBy: ((one(data.completer) as { full_name?: string } | null)?.full_name) ?? null,
    completedAt: (data.completed_at as string | null) ?? null,
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
      .map(p => ({
        id: p.id as string, kind: p.kind as string, path: p.path as string,
        url: signed.get(p.path as string) ?? null,
      })),
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
  /** Whose approval this is — from the disciplines on its lines. */
  approvers: ApproverKey[]
  /** Which stores hold what is being asked for, so the approver can see it
   *  can actually be met before saying yes. */
  heldAt: Array<{ locationId: string; label: string; itemCount: number }>
  /** When it left the store, and on which entry — the third step of the
   *  timeline on the card. Null until the storekeeper has issued it. */
  issuedAt: string | null
  issuedEntryId: string | null
  issuedEntryNo: string | null
  /** When somebody at the far end signed for it — the fourth and last step. */
  receivedAt: string | null
  receivedBy: string | null
  lines: Array<{ id: string; itemId: string; itemName: string; unit: string; qty: number; issuedQty: number; returnable: boolean }>
}

export async function loadRequests(opts: { projectId?: string | null; status?: string | null } = {}): Promise<RequestRow[]> {
  const supabase = await createClient()
  let q = supabase
    .from('mio_requests')
    .select(`id, no, project_id, status, needed_by, remarks, raised_at, decided_at, decision_note,
             projects:project_id ( name ), from_project:from_project_id ( name ),
             raiser:raised_by ( full_name ), decider:decided_by ( full_name ),
             mio_request_lines ( id, item_id, unit, qty, issued_qty, returnable,
                                 mio_items ( name, discipline:discipline_id ( code ) ) )`)
    // An approver's queue reads OLDEST FIRST: the thing that has been waiting
    // longest is the thing to do next, and a newest-first queue buries it.
    // Every other list is a history, and histories read newest first.
    .order('raised_at', { ascending: opts.status === 'pending' })
    .limit(200)
  if (opts.projectId) q = q.eq('project_id', opts.projectId)
  if (opts.status) q = q.eq('status', opts.status)

  const { data } = await q

  /**
   * Where the material actually is, per request.
   *
   * Aksha, 16 Sep 2026: "all data should show to the approver". Approving
   * blind is approving a promise — Mayank could say yes to 4,111 SqFt that the
   * store does not hold, and nobody finds out until the storekeeper opens it.
   * Folding the ledger once here costs one query and answers "can this be
   * met" on the card.
   */
  /**
   * Where each request GOT TO — the issue entry it turned into, and whether
   * anybody has signed for it at the far end.
   *
   * One query for every request on the page rather than one each. Aksha,
   * 16 Sep 2026: the card should show a timeline, and a timeline whose third
   * step is missing is just a status by another name.
   */
  const requestIds = (data ?? []).map(r => r.id as string)
  const { data: issues } = requestIds.length
    ? await supabase
      .from('mio_entries')
      .select('id, no, entry_at, request_id, receiver_signed_at, receiver:receiver_signed_by ( full_name )')
      .in('request_id', requestIds)
      .neq('stage', 'void')
      .order('entry_at')
    : { data: [] as Array<Record<string, unknown>> }

  const issueOf = new Map<string, Record<string, unknown>>()
  for (const e of issues ?? []) {
    // The FIRST issue is when the material left; a part-issue followed by a
    // second one should not keep resetting the date the site was served.
    const k = e.request_id as string
    if (!issueOf.has(k)) issueOf.set(k, e)
  }

  const [stock, lists] = await Promise.all([loadStock(), loadLists()])
  const stockFor = (itemIds: readonly string[]) => {
    const want = new Set(itemIds)
    const byPlace = new Map<string, number>()
    for (const row of stock) {
      if (row.qty > 0 && row.locationId && want.has(row.itemId)) {
        byPlace.set(row.locationId, (byPlace.get(row.locationId) ?? 0) + 1)
      }
    }
    return [...byPlace.entries()]
      .map(([locationId, itemCount]) => ({
        locationId,
        label: locationLabel(lists, locationId) ?? 'an unnamed place',
        itemCount,
      }))
      .sort((a, b) => b.itemCount - a.itemCount || a.label.localeCompare(b.label))
  }

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
    heldAt: stockFor(
      ((r.mio_request_lines as Array<Record<string, unknown>> | null) ?? [])
        .map(l => l.item_id as string),
    ),
    issuedAt: (issueOf.get(r.id as string)?.entry_at as string | null) ?? null,
    issuedEntryId: (issueOf.get(r.id as string)?.id as string | null) ?? null,
    issuedEntryNo: (issueOf.get(r.id as string)?.no as string | null) ?? null,
    receivedAt: (issueOf.get(r.id as string)?.receiver_signed_at as string | null) ?? null,
    receivedBy: ((one(issueOf.get(r.id as string)?.receiver) as { full_name?: string } | null)?.full_name) ?? null,
    approvers: approversForRequest(
      ((r.mio_request_lines as Array<Record<string, unknown>> | null) ?? []).map(l => {
        const item = one(l.mio_items) as { discipline?: unknown } | null
        const d = one(item?.discipline) as { code?: string } | null
        return d?.code ?? null
      }),
    ),
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
/**
 * The shops to offer a guard before they search.
 *
 * IN4'S NAMES, not whatever was typed into an earlier entry. Aksha, 16 Sep
 * 2026: "names should come as per out IN4 data". The chips used to be the most
 * frequent party_name on past entries, which was free text — so they showed
 * six spellings nobody could match back to a purchase order, and tapping one
 * gave the storekeeper a name IN4 had never heard of.
 *
 * Recently seen first, because the same shop comes six times a week. Topped up
 * with whoever has the most OPEN purchase orders — the best available guess at
 * who is about to arrive when there is no history yet, which is exactly the
 * position on day one.
 */
export async function loadRecentParties(limit = 6): Promise<SupplierOpt[]> {
  const supabase = await createClient()

  const [{ data: seen }, { data: open }] = await Promise.all([
    supabase
      .from('mio_entries')
      .select('in4_party_id')
      .not('in4_party_id', 'is', null)
      .neq('stage', 'void')
      .order('entry_at', { ascending: false })
      .limit(120),
    supabase
      .from('in4_purchase_orders')
      .select('supplier_id')
      .eq('status', 'Approved')
      .in('grn_status', ['No', 'Partial'])
      .limit(400),
  ])

  const rank = new Map<number, number>()
  const bump = (id: number | null, by: number) => {
    if (id == null) return
    rank.set(id, (rank.get(id) ?? 0) + by)
  }
  // A shop this gate has actually seen beats one that merely has paperwork.
  for (const r of seen ?? []) bump(r.in4_party_id as number | null, 10)
  for (const r of open ?? []) bump(r.supplier_id as number | null, 1)

  const ids = [...rank.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id)
  if (ids.length === 0) return []

  const { data: parties } = await supabase
    .from('in4_parties')
    .select('id, name, city')
    .eq('kind', 'supplier')
    .in('id', ids)

  const byId = new Map((parties ?? []).map(r => [r.id as number, r]))
  return ids
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(r => ({
      id: r!.id as number,
      name: ((r!.name as string) ?? '').trim(),
      hint: ((r!.city as string | null) ?? '').trim() || null,
    }))
}

/* ── Purchase orders ────────────────────────────────────────────────────── */

/**
 * IN4 keys its party list by KIND AND ID TOGETHER: 423 contractors and 180
 * suppliers, and every one of the 180 supplier ids is also a contractor id.
 * Looking one up by id alone returns two rows where one is expected, so the
 * lookup errored and the supplier name came back null — on all 1,451 orders,
 * since the first day this screen existed. Never drop the kind.
 */
const SUPPLIER = 'supplier'

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

/** One row in the storekeeper's order picker. */
export interface OrderOption {
  /** The IN4 po_id, as a string. */
  key: string
  no: string
  party: string | null
  /** IN4's own project name, not a hub project. */
  projectName: string | null
  date: string | null
  value: number | null
  /** Something still to come on it. */
  open: boolean
  /** Lines not yet fully received. */
  linesDue: number
  /** This order's supplier is the name Security wrote at the gate. */
  fromGateParty: boolean
}

/**
 * Search the purchase orders for the picker.
 *
 * PURCHASE ORDERS ONLY. Work orders were here briefly because the field was
 * labelled "PO / WO", and Aksha took them out again on 15 Sep 2026: "yes
 * remove WO completely - only PO for this section". He is right — a work
 * order is a contract for labour, its BOQ lines carry a description and a
 * uom but never a material id, so it could never fill an item line; and 410
 * of the 1,616 approved ones were consultancy and design fees that no lorry
 * ever arrives against. Every purchase order, by contrast, is Material or
 * Asset — something that physically turns up.
 *
 * The serial is what people say out loud — "PO ninety-four" — so a bare
 * number matches anywhere in the number, tail included.
 *
 * Searching looks at EVERY order whatever its status: 180 of the 1,451 are
 * draft, cancelled or terminated, and hiding those is why an order somebody
 * was holding in their hand could not be found. With no query at all the list
 * is the 89 that are open, because that is the honest answer to "what could
 * be arriving now".
 */
export async function searchOrders(
  query: string,
  opts: { partyHint?: string | null; partyId?: number | null; limit?: number } = {},
): Promise<OrderOption[]> {
  const supabase = await createClient()
  const q = query.trim()
  const limit = opts.limit ?? 40

  // Approved orders only. Aksha, 15 Sep 2026: "Dont show Draft and unapporved
  // one" — 180 of the 1,451 are draft, cancelled, terminated or mid-approval,
  // and an order nobody has approved is not something to book material against.
  const APPROVED = 'Approved'

  // A storekeeper says the shop's name far more readily than the order number,
  // so the name is searched too. Two queries rather than one PostgREST `.or()`
  // string: the query is typed by a person and would have to be escaped into
  // that filter syntax, and a comma in a shop's name would quietly break it.
  const supplierIds = q ? await supplierIdsMatching(supabase, q) : []

  const base = () => supabase
    .from('in4_purchase_orders')
    .select('po_id, po_no, po_dt, supplier_id, project_id, po_value, status, grn_status')
    .eq('status', APPROVED)

  let rowsRaw: Array<Record<string, unknown>> = []
  if (q) {
    const [byNo, byParty] = await Promise.all([
      base().ilike('po_no', `%${q}%`).order('po_dt', { ascending: false }).limit(limit),
      supplierIds.length
        ? base().in('supplier_id', supplierIds).order('po_dt', { ascending: false }).limit(limit)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    ])
    const seen = new Set<number>()
    for (const r of [...(byNo.data ?? []), ...(byParty.data ?? [])]) {
      const id = r.po_id as number
      if (!seen.has(id)) { seen.add(id); rowsRaw.push(r) }
    }
  } else {
    // With no query the list IS the answer — all 89 open orders, not the first
    // 40 of them, because a storekeeper scrolling to the end of a capped list
    // has no way to know the one they want was cut off.
    const { data } = await base()
      .in('grn_status', ['No', 'Partial'])
      .order('po_dt', { ascending: false })
      .limit(200)
    rowsRaw = (data ?? []) as Array<Record<string, unknown>>
  }

  const projectIds = [...new Set(rowsRaw.map(p => p.project_id as number).filter(Boolean))]
  const [suppliers, { data: projects }] = await Promise.all([
    partyNames(supabase, SUPPLIER, [...new Set(rowsRaw.map(p => p.supplier_id as number).filter(Boolean))]),
    projectIds.length
      ? supabase.from('in4_projects').select('id, name').in('id', projectIds)
      : Promise.resolve({ data: [] as Array<{ id: number; name: string }> }),
  ])
  const projectById = new Map((projects ?? []).map(r => [r.id as number, (r.name as string) ?? '']))

  // How many lines are still due, in one query rather than one per order.
  const poIds = rowsRaw.map(p => p.po_id as number)
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

  // Where the gate PICKED a supplier there is an id, and the match is exact.
  // Where it was typed, fall back to comparing the words — right about one
  // time in seven on the names typed so far, which is why the picker exists.
  const hintId = opts.partyId ?? null
  const hint = hintId == null ? normName(opts.partyHint ?? '') : ''
  const rows: OrderOption[] = rowsRaw.map(p => {
    const party = suppliers.get(p.supplier_id as number) ?? null
    const supplierId = p.supplier_id as number | null
    return {
      key: String(p.po_id),
      no: (p.po_no as string) ?? '',
      party,
      projectName: projectById.get(p.project_id as number) ?? null,
      date: (p.po_dt as string | null) ?? null,
      value: p.po_value == null ? null : num(p.po_value),
      open: p.grn_status === 'No' || p.grn_status === 'Partial',
      linesDue: dueByPo.get(p.po_id as number) ?? 0,
      // Security already wrote down who turned up. Where that name matches a
      // supplier, their orders are almost certainly the ones being looked for,
      // so they go to the top rather than being hunted for.
      fromGateParty: hintId != null
        ? supplierId === hintId
        : !!hint && !!party && normName(party).includes(hint),
    }
  })

  // Three tiers: this delivery's own supplier, then anything else still open,
  // then what is already fully received. Newest first inside each.
  const tier = (o: OrderOption) => (o.fromGateParty && o.open ? 0 : o.open ? 1 : 2)
  return rows.sort((a, b) =>
    tier(a) - tier(b) || (b.date ?? '').localeCompare(a.date ?? ''))
}

/** The same loose comparison the gate uses — two people spell a shop two ways. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Suppliers whose name contains what was typed. */
async function supplierIdsMatching(supabase: Sb, q: string): Promise<number[]> {
  const { data } = await supabase
    .from('in4_parties')
    .select('id')
    .eq('kind', SUPPLIER)
    .ilike('name', `%${q}%`)
    .limit(60)
  return (data ?? []).map(r => r.id as number)
}

/** IN4's lines for one order — what was ordered and how much has landed
 *  already, so the storekeeper ticks rather than types. */
export interface PoLine {
  in4PoItemId: number
  materialId: number
  name: string
  unit: string
  ordered: number
  /** What IN4's own Goods Receipt Notes say has come in. */
  alreadyIn: number
  /**
   * What THIS section has counted in through the gate against the same line,
   * not counting the entry being filled in now.
   *
   * Without it the form offered the whole order a second time on a second
   * delivery — IN4's GRN quantity had not moved — which is how In: 16Sep26/001
   * and /002 booked 34,862 SqFt against a 33,142 SqFt order on 16 Sep 2026.
   * See checkReceipt in desk.ts for why the two figures are never added.
   */
  atGate: number
  rate: number
}

export interface OrderDetail {
  no: string
  party: string | null
  /** IN4's own project name. */
  projectName: string | null
  /** The hub project it resolves to, or null with the reason in projectWhy. */
  projectId: string | null
  projectWhy: string | null
  date: string | null
  value: number | null
  /** IN4's status when it is not a plain approved order — a cancelled or
   *  draft order can still be picked, but never silently. */
  status: string | null
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
export async function loadOrder(key: string, exceptEntryId?: string | null): Promise<OrderDetail | null> {
  const id = Number(key)
  if (!Number.isFinite(id)) return null
  const supabase = await createClient()

  const { data: po } = await supabase
    .from('in4_purchase_orders')
    .select('po_id, po_no, po_dt, project_id, supplier_id, po_value, status, grn_status')
    .eq('po_id', id).maybeSingle()
  if (!po) return null

  const [{ data: items }, party, { data: project }] = await Promise.all([
    supabase.from('in4_po_items')
      .select('item_id, material_id, uom_id, base_po_qty, grn_qty, net_rate, subproject_id')
      .eq('po_id', po.po_id),
    partyName(supabase, SUPPLIER, (po.supplier_id as number | null) ?? null),
    po.project_id
      ? supabase.from('in4_projects').select('name').eq('id', po.project_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  /**
   * What the gate has already counted against these order lines.
   *
   * Voided entries are left out — a struck-out entry took its stock back off
   * the ledger, and it must not go on holding a purchase order closed.
   */
  const poItemIds = (items ?? []).map(i => i.item_id as number).filter(Boolean)
  const gateSoFar = new Map<number, number>()
  if (poItemIds.length) {
    const { data: booked } = await supabase
      .from('mio_entry_lines')
      .select('in4_po_item_id, qty, mio_entries!inner ( id, stage )')
      .in('in4_po_item_id', poItemIds)
      .neq('mio_entries.stage', 'void')
    for (const b of booked ?? []) {
      const entry = one(b.mio_entries) as { id?: string } | null
      if (exceptEntryId && entry?.id === exceptEntryId) continue
      const k = b.in4_po_item_id as number
      gateSoFar.set(k, (gateSoFar.get(k) ?? 0) + num(b.qty))
    }
  }

  const materialIds = [...new Set((items ?? []).map(i => i.material_id as number).filter(Boolean))]
  const { data: mats } = materialIds.length
    ? await supabase.from('in4_materials').select('id, name, uom').in('id', materialIds)
    : { data: [] as Array<{ id: number; name: string; uom: string }> }
  const byMat = new Map((mats ?? []).map(m => [m.id as number, m]))
  const headerProject = ((project as { name?: string } | null)?.name as string | null) ?? null

  /**
   * THE SUB-PROJECT IS THE REAL ANSWER.
   *
   * Aksha, 16 Sep 2026: "NGH is main project - this should capture exact
   * project from the PO". He is right, and the precision is already in IN4 —
   * just not on the header. PO/SRASSK/NGH/2026-27/87 says "New Guest House" at
   * the top and "New Guest House B-Execution" on every line, and only the
   * second is a place material actually goes.
   *
   * 95 of the 96 live orders carry exactly ONE sub-project across their lines,
   * so this is nearly always unambiguous. Where an order spans two there is no
   * single answer, and the header is the honest fallback — a parent the
   * storekeeper narrows beats a child picked by coin toss.
   *
   * It also resolves MORE orders, not fewer: 37 of the live ones reach a hub
   * project through the sub-project against 24 through the header, because the
   * alias table was seeded from IN4's sub-project names in the first place.
   */
  const subIds = [...new Set(
    (items ?? []).map(i => i.subproject_id as number | null).filter(Boolean),
  )] as number[]
  let subName: string | null = null
  if (subIds.length === 1) {
    const { data: sp } = await supabase
      .from('in4_subprojects').select('name').eq('id', subIds[0]).maybeSingle()
    subName = ((sp as { name?: string } | null)?.name as string | null) ?? null
  }
  const projectName = subName ?? headerProject

  // Try the precise name first; fall back to the parent rather than nothing.
  const resolved = await resolveHubProject(supabase, projectName)
  const viaHeader = resolved.projectId == null && subName && headerProject
    ? await resolveHubProject(supabase, headerProject)
    : null

  return {
    no: (po.po_no as string) ?? '',
    party,
    projectName,
    ...(viaHeader?.projectId ? viaHeader : resolved),
    date: (po.po_dt as string | null) ?? null,
    value: po.po_value == null ? null : num(po.po_value),
    status: po.status === 'Approved' ? null : (po.status as string | null),
    lines: (items ?? []).map(i => {
      const m = byMat.get(i.material_id as number)
      return {
        in4PoItemId: i.item_id as number,
        materialId: i.material_id as number,
        name: (m?.name as string) ?? `Material ${i.material_id}`,
        unit: (m?.uom as string) ?? 'Nos',
        ordered: num(i.base_po_qty),
        alreadyIn: num(i.grn_qty),
        atGate: gateSoFar.get(i.item_id as number) ?? 0,
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

export interface StoreCounts {
  toComplete: number
  pendingRequests: number
  returnablesOut: number
  itemsHeld: number
  /** What the stock is worth at the last rate paid for each thing. */
  stockValue: number
  /** Stock rows with no rate at all — the reason stockValue understates. */
  unpricedRows: number
  /** Stock lines in hand. One item in two stores is two lines, which is why
   *  this is not itemsHeld — the caveat has to say "x of y LINES". */
  heldRows: number
  /** Approved and waiting for the storekeeper to hand out. */
  toIssue: number
  /** Gone out and nobody at the site has signed for it. */
  toReceive: number
}

export async function loadCounts(projectId?: string | null): Promise<StoreCounts> {
  const supabase = await createClient()
  const scoped = <T extends { eq: (c: string, v: string) => T }>(q: T) =>
    projectId ? q.eq('project_id', projectId) : q

  const [gate, reqs, issue, receive, returnables, stock] = await Promise.all([
    scoped(supabase.from('mio_entries').select('id', { count: 'exact', head: true }).eq('stage', 'gate') as never),
    scoped(supabase.from('mio_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') as never),
    scoped(supabase.from('mio_requests').select('id', { count: 'exact', head: true }).eq('status', 'approved') as never),
    scoped(supabase.from('mio_entries').select('id', { count: 'exact', head: true }).eq('direction', 'out').is('receiver_signed_at', null).neq('stage', 'void') as never),
    // Returnables are switched off, and the fold behind them is not free.
    // Asking for a list nothing will show is the sort of query that makes a
    // page slow for no reason anybody can see.
    RETURNABLES_ON ? loadReturnables(projectId ?? null) : Promise.resolve([] as ReturnableRow[]),
    loadStock(),
  ])

  const held = stock.filter(s => s.qty > 0)
  return {
    toComplete: (gate as { count: number | null }).count ?? 0,
    pendingRequests: (reqs as { count: number | null }).count ?? 0,
    toIssue: (issue as { count: number | null }).count ?? 0,
    toReceive: (receive as { count: number | null }).count ?? 0,
    returnablesOut: returnables.length,
    itemsHeld: heldItemCount(stock),
    // Never a silent zero for a missing rate: the unpriced rows are counted
    // separately so the screen can say the figure is understated.
    stockValue: held.reduce((s, r) => s + (r.lastRate == null ? 0 : r.lastRate * r.qty), 0),
    unpricedRows: held.filter(r => r.lastRate == null).length,
    heldRows: held.length,
  }
}

/**
 * What the setup is still missing — the line across the top of the Overview.
 *
 * Aksha, 16 Sep 2026, replacing the grey "what is not built yet" box with it.
 * Config belongs behind Masters; a gap that silently misroutes an approval is
 * not config, it is a fault, and it belongs where he will see it.
 *
 * Every figure is counted here rather than typed into the screen, because a
 * health line that goes stale is worse than none: it says "all clear" about a
 * store that is not.
 */
export async function loadSetupHealth(): Promise<HealthInput> {
  const supabase = await createClient()
  const [items, stock, lists, { count: staff }] = await Promise.all([
    loadItems(),
    loadStock(),
    loadLists(),
    supabase.from('mio_project_staff').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ])

  const active = items.filter(i => i.isActive)
  const held = new Set(stock.filter(s => s.qty > 0).map(s => s.itemId))
  const rateOf = new Map<string, number | null>()
  for (const s of stock) {
    if (s.qty > 0 && s.lastRate != null) rateOf.set(s.itemId, s.lastRate)
  }

  // A site with no project is a shared warehouse — only a storekeeper can see
  // it, which is right for the CT Warehouse and wrong for a site store.
  const sites = listsOf(lists, 'location').filter(l => !l.parentId && l.isActive)

  return {
    itemsWithoutDiscipline: active.filter(i => !i.disciplineId).length,
    duplicateNameGroups: duplicateNameGroups(active.map(i => ({ id: i.id, name: i.name }))).length,
    staffAssigned: staff ?? 0,
    // Only what is actually HELD: an item with no rate and no stock costs
    // nothing and understates nothing.
    itemsWithoutRate: [...held].filter(id => rateOf.get(id) == null
      && active.find(i => i.id === id)?.lastRate == null).length,
    locationsWithoutProject: sites.filter(s => !s.projectId).length,
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

  // Consultancy and design lines are fees, not places material goes. All
  // seven of them have taken zero deliveries since the section existed, and
  // dropping them also removes the three identical "Sheth House - Design"
  // rows that no dropdown could tell apart. Only Material In & Out hides
  // them — the money modules still need them.
  return groupProjects((data ?? [])
    .filter(r => !isServiceScope(r.name as string | null))
    .map(r => ({
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

/* ── Who brings material ────────────────────────────────────────────────── */

export interface SupplierOpt {
  id: number
  name: string
  /** City, to tell two shops with the same name apart. */
  hint: string | null
}

/**
 * IN4's suppliers, for the gate.
 *
 * Suppliers only — not the 423 contractors. A purchase order's supplier_id
 * points at kind='supplier', so this is exactly the list that can be matched
 * back to an order, which is the whole point of picking from it.
 *
 * A contractor's lorry can still arrive; Security types the name and the entry
 * saves with no id, which stays allowed for ever. The list is a shortcut, not
 * a gate.
 */
export async function loadSuppliers(): Promise<SupplierOpt[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('in4_parties')
    .select('id, name, city')
    .eq('kind', 'supplier')
    .eq('is_active', true)
    .order('name')
  return (data ?? []).map(r => ({
    id: r.id as number,
    name: ((r.name as string) ?? '').trim(),
    hint: ((r.city as string | null) ?? '').trim() || null,
  }))
}

/* ── Who works where ────────────────────────────────────────────────────── */

export interface StaffRow {
  id: string
  userId: string
  name: string
  email: string
  role: 'engineer' | 'site_head'
  projectId: string
  projectName: string
}

/** Every assignment, for the desk. */
export async function loadProjectStaff(): Promise<StaffRow[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_project_staff')
    .select('id, user_id, project_id, role, profiles:user_id ( full_name, email ), projects:project_id ( name )')
    .eq('is_active', true)

  const rows = (data ?? []).map(r => {
    const p = one(r.profiles) as { full_name?: string; email?: string } | null
    const pr = one(r.projects) as { name?: string } | null
    return {
      id: r.id as string,
      userId: r.user_id as string,
      name: p?.full_name ?? p?.email ?? 'Someone',
      email: p?.email ?? '',
      role: (r.role as 'engineer' | 'site_head') ?? 'engineer',
      projectId: r.project_id as string,
      projectName: pr?.name ?? 'Unknown project',
    }
  })
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.projectName.localeCompare(b.projectName))
}

/** The projects one person is on. Empty is a real answer, not a failure. */
export async function loadMyProjectIds(userId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('mio_project_staff')
    .select('project_id')
    .eq('user_id', userId)
    .eq('is_active', true)
  return (data ?? []).map(r => r.project_id as string)
}

/** Everyone who could be put on a site — engineers and the heads above them. */
export async function loadAssignablePeople(): Promise<Array<{ id: string; name: string; role: string }>> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, email, role')
    .in('role', ['engineer', 'site_staff', 'head', 'project_head'])
    .eq('is_active', true)
    .order('full_name')
  return (data ?? []).map(r => ({
    id: r.id as string,
    name: (r.full_name as string) || (r.email as string) || 'Someone',
    role: (r.role as string) ?? '',
  }))
}

/* ── One item's whole history ───────────────────────────────────────────── */

export interface ItemCard {
  id: string
  name: string
  unit: string
  discipline: string | null
  lastRate: number | null
  in4MaterialId: number | null
  isActive: boolean
  /** Where it sits right now, and how much is on each shelf. */
  at: Array<{ locationId: string | null; label: string; qty: number; value: number | null }>
}

/**
 * A bin card — the oldest tool in a store, and the one that makes people
 * believe the book.
 *
 * Aksha, 16 Sep 2026: "Item card". "Where did the 140 SqFt go?" had no answer
 * without opening entries one by one. Every movement of one item, with the
 * entry it came from, who did it and where it went.
 *
 * Read from the SAME ledger the stock screen folds, so the balance at the top
 * of the card is the number on the stock page by construction.
 */
export async function loadItemCard(itemId: string): Promise<{ item: ItemCard; moves: ItemMove[] } | null> {
  const supabase = await createClient()

  const { data: row } = await supabase
    .from('mio_items')
    .select('id, name, unit, in4_material_id, last_rate, is_active, discipline:discipline_id ( name )')
    .eq('id', itemId)
    .maybeSingle()
  if (!row) return null

  const [{ data: moves }, lists, stock] = await Promise.all([
    supabase
      .from('mio_movements')
      .select(`id, kind, qty, rate, moved_at, location_id, note, entry_id,
               entry:entry_id ( no, party_name, handed_over_to ),
               project:project_id ( name ),
               creator:created_by ( full_name )`)
      .eq('item_id', itemId)
      .order('moved_at'),
    loadLists(),
    loadStock(),
  ])

  const mine = stock.filter(s => s.itemId === itemId)
  const discipline = (one(row.discipline) as { name?: string } | null)?.name ?? null

  return {
    item: {
      id: row.id as string,
      name: (row.name as string) ?? '',
      unit: (row.unit as string) ?? '',
      discipline,
      lastRate: row.last_rate == null ? null : num(row.last_rate),
      in4MaterialId: (row.in4_material_id as number | null) ?? null,
      isActive: row.is_active !== false,
      at: mine
        .filter(s => s.qty !== 0)
        .map(s => ({
          locationId: s.locationId,
          label: locationLabel(lists, s.locationId) ?? 'Not placed',
          qty: s.qty,
          value: s.lastRate == null ? null : s.lastRate * s.qty,
        }))
        .sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label)),
    },
    moves: (moves ?? []).map(m => {
      const entry = one(m.entry) as { no?: string; party_name?: string; handed_over_to?: string } | null
      const project = one(m.project) as { name?: string } | null
      const creator = one(m.creator) as { full_name?: string } | null
      return {
        id: m.id as string,
        kind: m.kind as ItemMove['kind'],
        qty: num(m.qty),
        rate: m.rate == null ? null : num(m.rate),
        movedAt: m.moved_at as string,
        entryId: (m.entry_id as string | null) ?? null,
        entryNo: entry?.no ?? null,
        // An IN names who brought it; an OUT names who took it. Both are "the
        // other party", which is the column a bin card has always had.
        party: entry?.party_name ?? entry?.handed_over_to ?? null,
        project: project?.name ?? null,
        place: locationLabel(lists, (m.location_id as string | null) ?? null),
        who: creator?.full_name ?? null,
        note: (m.note as string | null) ?? null,
      }
    }),
  }
}

/* ── Waiting to be signed for at the far end ────────────────────────────── */

export interface AwaitingReceipt {
  id: string
  no: string
  requestNo: string | null
  projectId: string | null
  projectName: string | null
  /** The store it came out of. */
  fromLabel: string | null
  issuedAt: string
  issuedBy: string | null
  handedOverTo: string | null
  lines: Array<{ id: string; itemName: string; unit: string; qty: number }>
}

/**
 * Material that has left the store and nobody has signed for.
 *
 * Aksha, 16 Sep 2026: "Where will the reciever do the entry - i cant see the
 * page or section of the same". It existed — as a panel at the foot of one
 * entry page, reachable only by already knowing the entry number. A step with
 * no list is a step nobody does, which is why not one of the issues on record
 * has ever been signed for.
 *
 * Scoped like everything else: a site sees what is coming to IT. The
 * storekeeper sees all of it, because they are the one who has to chase it.
 */
export async function loadAwaitingReceipt(projectIds: readonly string[] | null): Promise<AwaitingReceipt[]> {
  const supabase = await createClient()
  let q = supabase
    .from('mio_entries')
    .select(`id, no, entry_at, project_id, location_id, handed_over_to, completed_at,
             projects:project_id ( name ),
             completer:completed_by ( full_name ),
             request:request_id ( no ),
             mio_entry_lines ( id, unit, qty, mio_items ( name ) )`)
    .eq('direction', 'out')
    .is('receiver_signed_at', null)
    .neq('stage', 'void')
    .order('entry_at', { ascending: true })
    .limit(200)

  // null means "everything" — the storekeeper and the heads.
  if (projectIds) {
    if (projectIds.length === 0) return []
    q = q.in('project_id', projectIds)
  }

  const { data } = await q
  const lists = await loadLists()

  return (data ?? []).map(r => ({
    id: r.id as string,
    no: (r.no as string) ?? '',
    requestNo: ((one(r.request) as { no?: string } | null)?.no) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    projectName: ((one(r.projects) as { name?: string } | null)?.name) ?? null,
    fromLabel: locationLabel(lists, (r.location_id as string | null) ?? null),
    issuedAt: (r.completed_at as string | null) ?? (r.entry_at as string),
    issuedBy: ((one(r.completer) as { full_name?: string } | null)?.full_name) ?? null,
    handedOverTo: (r.handed_over_to as string | null) ?? null,
    lines: ((r.mio_entry_lines as Array<Record<string, unknown>> | null) ?? []).map(l => ({
      id: l.id as string,
      itemName: ((one(l.mio_items) as { name?: string } | null)?.name) ?? '—',
      unit: (l.unit as string) ?? '',
      qty: num(l.qty),
    })),
  }))
}
