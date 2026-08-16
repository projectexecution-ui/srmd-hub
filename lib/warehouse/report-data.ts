import { createClient } from '@/lib/supabase/server'
import { getLocationTree, one } from './data'
import { foldLedger, groupByLocation, stockFlag, stockTotals, todayIST } from './ledger'
import type { LedgerRow, MovementKind, StockLine, StockGroup, StockTotals } from './ledger'
import { inPeriod } from './registers'
import type { RegisterKind, RegisterRow } from './registers'

/** PostgREST caps a request at 1,000 rows by default, and a register that
 *  silently stops at row 1,000 is a register that lies. Everything here pages
 *  until the source is exhausted. */
const PAGE = 1000

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1)
    if (error) return { rows, error: error.message }
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE) return { rows, error: null }
    // A runaway guard: 200 pages is 200,000 movements, far past anything a gate
    // register produces, and better than looping forever on a bad cursor.
    if (page > 200) return { rows, error: 'Too many rows to read in one go — narrow the period.' }
  }
}

/** yyyy-mm-dd in IST for a timestamptz. The register's day is the site's day. */
function istDay(ts: string): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** The BUSINESS day a movement belongs to.
 *
 *  `created_at` is when it was typed; the register is about when it happened.
 *  They are the same today because nothing can be back-dated yet, but reading
 *  the source entry's date keeps "stock as on 31 March" correct the day
 *  back-dating is allowed. */
async function businessDays(refs: Array<{ ref_table: string | null; ref_id: string | null }>) {
  const sb = await createClient()
  const byTable = new Map<string, Set<string>>()
  for (const r of refs) {
    if (!r.ref_table || !r.ref_id) continue
    if (!byTable.has(r.ref_table)) byTable.set(r.ref_table, new Set())
    byTable.get(r.ref_table)!.add(r.ref_id)
  }

  const day = new Map<string, string>()
  for (const [table, ids] of byTable) {
    const dateCol = table === 'wh_counts' ? 'approved_at' : 'entry_date'
    const list = [...ids]
    for (let i = 0; i < list.length; i += PAGE) {
      const { data } = await sb.from(table).select(`id, ${dateCol}`).in('id', list.slice(i, i + PAGE))
      for (const row of (data ?? []) as Array<Record<string, string | null>>) {
        const v = row[dateCol]
        if (v) day.set(`${table}|${row.id}`, v.length > 10 ? istDay(v) : v)
      }
    }
  }
  return day
}

export type StockView = {
  asOn: string
  groups: StockGroup[]
  lines: StockLine[]
  totals: StockTotals
  error: string | null
}

/** Book stock as on a date, storage-location-wise — the "Total Stock" register.
 *
 *  Built from the ledger rather than read off `wh_stock`, because `wh_stock` is
 *  only ever "now" and every question here is about a date. It also means the
 *  screen and the ledger can never disagree: if they did, one of them would be
 *  wrong and nobody would know which. */
export async function getStockView(opts: {
  asOn?: string
  locationId?: string | null
  discipline?: string | null
} = {}): Promise<StockView> {
  const asOn = opts.asOn || todayIST()
  const sb = await createClient()

  const [movRes, itemsRes, minRes, sites] = await Promise.all([
    fetchAll<{
      item_id: string; location_id: string; kind: MovementKind; qty: string
      created_at: string; rate: string | null; ref_table: string | null; ref_id: string | null
    }>((from, to) => sb
      .from('wh_movements')
      .select('item_id, location_id, kind, qty, created_at, rate, ref_table, ref_id')
      .order('created_at')
      .range(from, to)),
    sb.from('wh_items').select('id, name, unit, category, discipline, last_rate').is('deleted_at', null),
    sb.from('wh_stock').select('item_id, location_id, min_qty').not('min_qty', 'is', null),
    getLocationTree(),
  ])

  if (movRes.error) {
    return { asOn, groups: [], lines: [], totals: emptyTotals(), error: movRes.error }
  }
  if (itemsRes.error) {
    return { asOn, groups: [], lines: [], totals: emptyTotals(), error: itemsRes.error.message }
  }

  const day = await businessDays(movRes.rows)
  const ledger: LedgerRow[] = movRes.rows.map(m => ({
    itemId: m.item_id,
    locationId: m.location_id,
    kind: m.kind,
    qty: Number(m.qty),
    day: (m.ref_table && m.ref_id ? day.get(`${m.ref_table}|${m.ref_id}`) : null) ?? istDay(m.created_at),
    rate: m.rate == null ? null : Number(m.rate),
  }))

  const items = new Map((itemsRes.data ?? []).map(i => [i.id, i]))
  const spots = new Map(sites.flatMap(s => s.spots).map(sp => [sp.id, sp]))
  const mins = new Map((minRes.data ?? []).map(r => [`${r.item_id}|${r.location_id}`, Number(r.min_qty)]))

  const lines: StockLine[] = foldLedger(ledger, asOn).flatMap(c => {
    const item = items.get(c.itemId)
    const spot = spots.get(c.locationId)
    if (!item || !spot) return []
    if (opts.locationId && c.locationId !== opts.locationId) return []
    if (opts.discipline && item.discipline !== opts.discipline) return []
    const minQty = mins.get(`${c.itemId}|${c.locationId}`) ?? null
    const rate = item.last_rate == null ? null : Number(item.last_rate)
    return [{
      ...c,
      itemName: item.name, unit: item.unit, category: item.category, discipline: item.discipline,
      locationName: spot.name, siteName: spot.siteName,
      minQty, rate,
      value: rate == null ? 0 : c.inHand * rate,
      flag: stockFlag(c.inHand, minQty),
    }]
  })

  return { asOn, groups: groupByLocation(lines), lines, totals: stockTotals(lines), error: null }
}

function emptyTotals(): StockTotals {
  return {
    items: 0, locations: 0, value: 0, low: 0, nil: 0,
    countShortQty: 0, countShortValue: 0, valuePartial: false,
  }
}

/** One of the four entry registers, for a period. */
export async function getRegister(
  kind: RegisterKind,
  from: string | null,
  to: string | null,
): Promise<{ rows: RegisterRow[]; error: string | null }> {
  return kind === 'vendor-in' || kind === 'srm-in'
    ? getInRegister(kind === 'vendor-in' ? 'vendor' : 'srm', from, to)
    : getOutRegister(kind === 'vendor-out' ? 'vendor' : 'site', from, to)
}

async function getInRegister(
  owner: 'srm' | 'vendor',
  from: string | null,
  to: string | null,
): Promise<{ rows: RegisterRow[]; error: string | null }> {
  const sb = await createClient()
  const res = await fetchAll<InRow>((f, t) => {
    let q = sb
      .from('wh_gate_in')
      .select(`id, entry_no, entry_date, party, entity, remarks, po_no_text,
               wh_po(po_no), projects(name), wh_locations(name),
               wh_gate_in_lines(id, received_qty, damaged_qty, good_qty, short_qty, rate,
                                differs_from_po, differ_note,
                                wh_items(id, name, unit, category, discipline),
                                po_line:wh_po_lines(source_text, wh_items(name)))`)
      .eq('owner', owner)
      .is('deleted_at', null)
      .order('entry_date', { ascending: false })
      .range(f, t)
    if (from) q = q.gte('entry_date', from)
    if (to) q = q.lte('entry_date', to)
    return q
  })
  if (res.error) return { rows: [], error: res.error }

  const rows: RegisterRow[] = []
  for (const e of res.rows) {
    if (!inPeriod(e.entry_date, from, to)) continue
    for (const l of e.wh_gate_in_lines ?? []) {
      const item = one(l.wh_items)
      if (!item) continue
      // GOOD quantity, not received: damaged material never became stock, so a
      // purchase register that counts it overstates what we actually got. (#10)
      const qty = Number(l.good_qty)
      const rate = l.rate == null ? null : Number(l.rate)
      rows.push({
        entryId: e.id, entryNo: e.entry_no, day: e.entry_date,
        party: e.party, projectName: one(e.projects)?.name ?? null, entity: e.entity,
        storeName: one(e.wh_locations)?.name ?? '—',
        itemId: item.id, itemName: item.name, unit: item.unit,
        category: item.category, discipline: item.discipline,
        qty, rate, amount: rate == null ? null : qty * rate,
        shortQty: Math.max(0, Number(l.short_qty)),
        damagedQty: Number(l.damaged_qty),
        poNo: one(e.wh_po)?.po_no ?? e.po_no_text ?? null,
        differsFromPo: l.differs_from_po ?? false,
        differNote: l.differ_note ?? null,
        orderedText: l.differs_from_po
          ? (one(l.po_line)?.source_text ?? one(one(l.po_line)?.wh_items)?.name ?? null)
          : null,
        remarks: e.remarks,
      })
    }
  }
  return { rows, error: null }
}

async function getOutRegister(
  dest: 'site' | 'vendor',
  from: string | null,
  to: string | null,
): Promise<{ rows: RegisterRow[]; error: string | null }> {
  const sb = await createClient()
  const res = await fetchAll<OutRow>((f, t) => {
    let q = sb
      .from('wh_gate_out')
      .select(`id, entry_no, entry_date, party, entity, remarks, is_returnable, return_due_date,
               projects(name), from_loc:wh_locations!wh_gate_out_from_location_id_fkey(name),
               engineer:profiles!wh_gate_out_engineer_id_fkey(full_name, email),
               wh_gate_out_lines(id, qty, rate, returned_qty, wh_items(id, name, unit, category, discipline))`)
      .eq('dest_type', dest)
      .is('deleted_at', null)
      .order('entry_date', { ascending: false })
      .range(f, t)
    if (from) q = q.gte('entry_date', from)
    if (to) q = q.lte('entry_date', to)
    return q
  })
  if (res.error) return { rows: [], error: res.error }

  const rows: RegisterRow[] = []
  for (const e of res.rows) {
    if (!inPeriod(e.entry_date, from, to)) continue
    const eng = one(e.engineer)
    for (const l of e.wh_gate_out_lines ?? []) {
      const item = one(l.wh_items)
      if (!item) continue
      const qty = Number(l.qty)
      const rate = l.rate == null ? null : Number(l.rate)
      rows.push({
        entryId: e.id, entryNo: e.entry_no, day: e.entry_date,
        party: e.party, projectName: one(e.projects)?.name ?? null, entity: e.entity,
        storeName: one(e.from_loc)?.name ?? '—',
        itemId: item.id, itemName: item.name, unit: item.unit,
        category: item.category, discipline: item.discipline,
        qty, rate, amount: rate == null ? null : qty * rate,
        engineerName: eng?.full_name || eng?.email || null,
        remarks: e.remarks,
      })
    }
  }
  return { rows, error: null }
}

/** Vendor material in and out, in one shape, for the balance. */
export async function getVendorMovements(from: string | null, to: string | null) {
  const [ins, outs] = await Promise.all([
    getRegister('vendor-in', from, to),
    getRegister('vendor-out', from, to),
  ])
  return {
    ins: ins.rows, outs: outs.rows,
    error: ins.error ?? outs.error,
  }
}

/** Disciplines that actually appear on items, for the stock filter. */
export async function getDisciplines(): Promise<string[]> {
  const sb = await createClient()
  const { data } = await sb
    .from('wh_items')
    .select('discipline')
    .is('deleted_at', null)
    .not('discipline', 'is', null)
  return [...new Set((data ?? []).map(r => r.discipline as string))].sort((a, b) => a.localeCompare(b))
}

type Embedded<T> = T | T[] | null

type InRow = {
  id: string; entry_no: string; entry_date: string
  party: string; entity: string | null; remarks: string | null; po_no_text: string | null
  wh_po: Embedded<{ po_no: string }>
  projects: Embedded<{ name: string }>
  wh_locations: Embedded<{ name: string }>
  wh_gate_in_lines: Array<{
    id: string; received_qty: string; damaged_qty: string; good_qty: string
    short_qty: string; rate: string | null
    differs_from_po: boolean | null; differ_note: string | null
    wh_items: Embedded<{ id: string; name: string; unit: string; category: string | null; discipline: string | null }>
    po_line: Embedded<{ source_text: string | null; wh_items: Embedded<{ name: string }> }>
  }> | null
}

type OutRow = {
  id: string; entry_no: string; entry_date: string
  party: string | null; entity: string | null; remarks: string | null
  is_returnable: boolean; return_due_date: string | null
  projects: Embedded<{ name: string }>
  from_loc: Embedded<{ name: string }>
  engineer: Embedded<{ full_name: string | null; email: string | null }>
  wh_gate_out_lines: Array<{
    id: string; qty: string; rate: string | null; returned_qty: string
    wh_items: Embedded<{ id: string; name: string; unit: string; category: string | null; discipline: string | null }>
  }> | null
}
