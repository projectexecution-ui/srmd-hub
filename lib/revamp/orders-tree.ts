// Budget vs Actual, pill 2 — "Category — WO/PO wise" (build order §2/§3).
//
// The orders tree, four levels deep, on the SAME spine as the Internal
// Estimate so a figure here traces to the same row there:
//
//   category → sub-category → order → line item
//
// Everything is live IN4, mirrored. The only derived figure is Balance, a
// subtraction of two amounts IN4 holds (§10).
//
// ── SEQUENCE ────────────────────────────────────────────────────────────────
// Rows follow IN4's OWN code order — 01 Site Pre-lims, 03 Civil, 07 Electrical,
// 08 Plumbing, 09 Fire Fighting, 12 Finishes — and sub-categories likewise
// (602, 702, 703, 806). The first cut of this screen sorted categories by
// value, biggest first, which put the tree in a different order from every
// other screen in the hub and from the Excel people read alongside it. A tree
// whose spine is meant to match the Internal Estimate has to be in the
// Internal Estimate's order. Codes are compared numerically, so 9 sorts before
// 12 rather than after it.
//
// ── WHAT THE DATA ACTUALLY LOOKS LIKE, checked on NGH B before building ──
//
// 1. A work order carries BOTH `category_id` and `subcategory_id`, both into
//    `in4_skills` (a two-level tree; parent_id 0 = category).
// 2. A purchase order does NOT. An indent line carries a single `skill_id`,
//    and on every line checked it is a TOP-LEVEL category. So POs sit at
//    category level rather than under a sub-category IN4 never assigned.
// 3. 6 of NGH B's 29 work orders have NO sub-category. They get a stated row;
//    dropping them would take money out of a total still claiming to be whole.
// 4. `pos` is a JSON ARRAY and 19 of NGH B's lines carry TWO purchase orders.
//    Reading `pos->0` silently loses the second on every one. Always unnest.
// 5. 402 PO lines resolve to 74 distinct PO numbers. The order COUNT is of
//    distinct numbers; the money is still every line's.
// 6. Four PO lines are drafts. A draft is not a committed order, so it is out
//    of the totals and said out loud.
// 7. Work-order `status` is an undecoded integer (2 and 6 appear) and is not
//    shown — inventing labels for unmapped codes is the guessing §10 forbids.
// 8. NGH B's 206 BOQ lines sum to ₹9,18,43,330, EXACTLY its total work-order
//    value. The line items reconcile to the order, so the deepest level of the
//    tree adds up to the top of it.

import { formatINR } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'

/** One bill (IN4 "abstract" / certificate) against one line item. */
export interface LineBill {
  billNo: string | null
  date: string | null
  qty: number
  amount: number
}

export interface OrderLine {
  id: string
  name: string
  /** IN4's own longer text, where it holds one. */
  description: string | null
  uom: string | null
  qty: number | null
  rate: number | null
  amount: number
  /** What has been CERTIFIED (billed and passed) against this line so far,
   *  summed over its bills — IN4 records quantity per bill, never per
   *  payment, so this is the item-wise breakup of work done and billed.
   *  Null when IN4 holds no bill against the line; never a zero pretending
   *  to be a measurement. Joined on (wo_id, item_id) — never boq_id, which
   *  the two IN4 facts disagree on by one. */
  certifiedQty: number | null
  certifiedAmt: number | null
  bills: LineBill[]
}

export interface OrderRow {
  id: string
  /** WO number or PO number, as IN4 writes it. */
  ref: string
  party: string | null
  kind: 'wo' | 'po'
  /** IN4's WORK_ORDER_VALUE — the price of the work BEFORE GST. The BOQ lines
   *  under the order add up to this (1,666 of 1,670 orders, to the rupee). */
  ordered: number
  /** IN4's WO_GROSS_VALUE — the same order WITH GST, i.e. what the contractor
   *  actually bills. WO only; IN4's PO feed carries no gross. */
  gross: number | null
  /** IN4's WO_PAID_AMT. Payments are made against bills, so this INCLUDES
   *  GST. WO only — IN4's PO feed carries no payment. */
  paid: number | null
  /** gross − paid: the only figure on this screen that is arithmetic rather
   *  than a value IN4 holds. Both sides carry GST, so it is like-for-like.
   *  Subtracting Paid from the ex-GST Ordered — the first cut — made 353 of
   *  1,670 orders look overpaid when the contractor was simply billed tax. */
  balance: number | null
  lines: OrderLine[]
  /** Sum of the line items, kept so a reader can see when it does NOT equal
   *  Ordered and why (see lineNote). */
  lineTotal: number
  /** Sum of the lines' certified amounts; null when no line has a bill. This
   *  is work billed, before GST — not the same thing as Paid, which IN4 holds
   *  per order, after GST, and after retention and recoveries. */
  certifiedAmt: number | null
  /** Set only when the lines do not add up to the order value: IN4 applied a
   *  discount (lines above value) or the order was amended (lines below). A
   *  fact about the IN4 record, stated so it is not read as a CT Hub error. */
  lineNote: string | null
}

export interface OrdersSubRow {
  id: string
  name: string
  /** IN4's sequence code, used for ordering and shown nowhere else. */
  code: string
  kind: 'wo' | 'po'
  count: number
  ordered: number
  gross: number | null
  paid: number | null
  balance: number | null
  unassigned?: boolean
  orders: OrderRow[]
}

export interface OrdersCatRow {
  id: string
  name: string
  code: string
  subs: OrdersSubRow[]
  count: number
  ordered: number
  /** Work orders only — a category that also holds POs shows a gross below
   *  its Ordered, because IN4 holds no gross for a PO. */
  gross: number | null
  paid: number | null
  balance: number | null
}

export interface OrdersTree {
  cats: OrdersCatRow[]
  totals: { ordered: number; gross: number; paid: number; balance: number; woCount: number; poCount: number; lineCount: number }
  notes: string[]
  linked: boolean
  error: string | null
}

const EMPTY: OrdersTree = {
  cats: [], totals: { ordered: 0, gross: 0, paid: 0, balance: 0, woCount: 0, poCount: 0, lineCount: 0 },
  notes: [], linked: false, error: null,
}

export interface WoRow {
  wo_id: number
  category_id: number | null
  subcategory_id: number | null
  wo_value: number | null
  wo_gross_value: number | null
  wo_paid_amt: number | null
  display_no: string | null
  contractor_id: number | null
}
export interface BoqRow {
  item_id: number
  wo_id: number
  boq_name: string | null
  boq_subname: string | null
  description: string | null
  uom: string | null
  quantity: number | null
  rate: number | null
  amt: number | null
}
/** One row of in4_wo_abstract_items: a line item on one bill. */
export interface AbstractRow {
  wo_id: number
  item_id: number
  executed_quantity: number | null
  executed_amt: number | null
  bill_no: string | null
  display_no: string | null
  abstract_dt: string | null
}
export interface IndentRow {
  indent_item_id?: number
  skill_id: number | null
  material_name: string | null
  uom: string | null
  pos: unknown
}
export interface PoEntry { poNo?: string; amount?: number; draft?: boolean; qty?: number; rate?: number; supplier?: string }

export interface Skill { id: number; name: string | null; code: string | null }

/** Where a row sits within its category, before its code is considered:
 *  the work-order sub-categories in IN4 order, then the purchase-order row,
 *  then the bucket for work orders IN4 never sub-categorised.
 *
 *  This was first done by giving the PO and unassigned rows sentinel CODES
 *  (U+FFFE / U+FFFF) so they would sort last. They did not: those codes are
 *  not numeric, so the comparison fell through to a locale compare, which
 *  put them FIRST. Rank is explicit now — a sort order should not depend on
 *  where a private-use character lands in a collation table. */
function rankOf(s: { kind: 'wo' | 'po'; unassigned?: boolean }): number {
  if (s.unassigned) return 2
  return s.kind === 'po' ? 1 : 0
}

/** IN4 codes are numeric strings ("01", "09", "12", "602"). Compared as text,
 *  "12" sorts before "9"; compared numerically it does not. */
function byCode(a: string, b: string): number {
  const na = Number(a), nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a.localeCompare(b, undefined, { numeric: true })
}

/** PostgREST caps a plain select at 1,000 rows. NGH B's 206 BOQ lines are well
 *  under, but a big project is not, and the failure is silent — the tree would
 *  simply stop adding up. Paged explicitly. (A 1,000-row cap doing exactly
 *  this went unnoticed in the warehouse sync for weeks.) */
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: string | null }> {
  const PAGE = 1000
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1)
    if (error) return { rows, error: error.message }
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE) break
  }
  return { rows, error: null }
}

/** The minimum a Supabase client needs to look up party names — small on
 *  purpose so a test can hand in a stub and check the query that is built. */
export interface PartyReader {
  from(table: string): {
    select(cols: string): {
      eq(col: string, v: string): {
        in(col: string, ids: number[]): {
          range(f: number, t: number): PromiseLike<{ data: unknown; error: { message: string } | null }>
        }
      }
    }
  }
}

/** Contractor names for a set of work orders.
 *
 *  `in4_parties` is keyed on (kind, id), NOT on id. Contractors come from IN4's
 *  ENGG_SERVICE_PROVIDER and suppliers from PURCH_SUPPLIER, two tables that
 *  each number from 1, so 178 of the 601 ids exist as BOTH a contractor and a
 *  supplier — id 3 is Desai Construction and also Beyond The Best Services.
 *  1,316 of 1,670 work orders sit on such an id. Without the kind filter the
 *  lookup returned two rows per id and the Map below kept whichever Postgres
 *  sent last, so WO 233 showed a supplier's name. The filter is load-bearing. */
export function contractorNames(
  supabase: PartyReader,
  wos: ReadonlyArray<{ contractor_id: number | null }>,
): Promise<{ rows: Array<{ id: number; name: string | null }>; error: string | null }> {
  const ids = [...new Set(wos.map(w => w.contractor_id).filter((v): v is number => v != null))]
  return ids.length
    ? fetchAll<{ id: number; name: string | null }>((f, t) =>
        supabase.from('in4_parties').select('id, name').eq('kind', 'contractor').in('id', ids).range(f, t))
    : Promise.resolve({ rows: [], error: null })
}

export async function loadOrdersTree(projectId: string): Promise<OrdersTree> {
  const supabase = await createClient()

  // Project → IN4 sub-projects through the two HUMAN-CONFIRMED link tables.
  // Never a name match: attaching another building's orders here would be
  // worse than showing none.
  const { data: links, error: linkErr } = await supabase
    .from('cc_bph_project_links').select('bph_project_id').eq('cc_project_id', projectId)
  if (linkErr) return { ...EMPTY, error: linkErr.message }
  const bphIds = (links ?? []).map(r => r.bph_project_id as string).filter(Boolean)
  if (bphIds.length === 0) return EMPTY

  const { data: subLinks, error: subErr } = await supabase
    .from('in4_subproject_links').select('subproject_id').in('bph_project_id', bphIds)
  if (subErr) return { ...EMPTY, error: subErr.message }
  const subIds = [...new Set((subLinks ?? []).map(r => r.subproject_id as number))]
  if (subIds.length === 0) return EMPTY

  // Deliberately NOT widened to sibling sub-projects the way the CT-wise pill
  // is. That pill LISTS each sub-project, so widening is visible there; here it
  // would fold a neighbouring building into this project's categories with
  // nothing on screen to say so.
  const [woRes, indentRes] = await Promise.all([
    fetchAll<WoRow>((f, t) => supabase.from('in4_work_orders')
      .select('wo_id, category_id, subcategory_id, wo_value, wo_gross_value, wo_paid_amt, display_no, contractor_id')
      .in('subproject_id', subIds).range(f, t)),
    fetchAll<IndentRow>((f, t) => supabase.from('in4_indent_items')
      .select('indent_item_id, skill_id, material_name, uom, pos')
      .in('subproject_id', subIds).range(f, t)),
  ])
  if (woRes.error) return { ...EMPTY, linked: true, error: woRes.error }
  if (indentRes.error) return { ...EMPTY, linked: true, error: indentRes.error }

  const wos = woRes.rows
  const indents = indentRes.rows
  const woIds = wos.map(w => w.wo_id)

  const [boqRes, skillRes, partyRes, absRes] = await Promise.all([
    woIds.length
      ? fetchAll<BoqRow>((f, t) => supabase.from('in4_wo_boq_items')
          .select('item_id, wo_id, boq_name, boq_subname, description, uom, quantity, rate, amt')
          .in('wo_id', woIds).range(f, t))
      : Promise.resolve({ rows: [] as BoqRow[], error: null }),
    (() => {
      const ids = new Set<number>()
      for (const w of wos) {
        if (w.category_id != null) ids.add(w.category_id)
        if (w.subcategory_id != null) ids.add(w.subcategory_id)
      }
      for (const i of indents) if (i.skill_id != null) ids.add(i.skill_id)
      return ids.size
        ? fetchAll<Skill>((f, t) => supabase.from('in4_skills').select('id, name, code').in('id', [...ids]).range(f, t))
        : Promise.resolve({ rows: [] as Skill[], error: null })
    })(),
    // The cast is deliberate: asking TypeScript to check the full Supabase
    // client against PartyReader structurally makes it instantiate the
    // builder's generic types until it gives up ("excessively deep").
    // PartyReader names exactly the five calls contractorNames makes.
    contractorNames(supabase as unknown as PartyReader, wos),
    // Every bill line against these orders. Raj Uphaar alone has 3,502, so
    // this pages like the BOQ read. Joined to lines on (wo_id, item_id).
    woIds.length
      ? fetchAll<AbstractRow>((f, t) => supabase.from('in4_wo_abstract_items')
          .select('wo_id, item_id, executed_quantity, executed_amt, bill_no, display_no, abstract_dt')
          .in('wo_id', woIds).range(f, t))
      : Promise.resolve({ rows: [] as AbstractRow[], error: null }),
  ])
  if (boqRes.error) return { ...EMPTY, linked: true, error: boqRes.error }
  if (absRes.error) return { ...EMPTY, linked: true, error: absRes.error }
  if (skillRes.error) return { ...EMPTY, linked: true, error: skillRes.error }
  if (partyRes.error) return { ...EMPTY, linked: true, error: partyRes.error }

  const skills = new Map<number, Skill>(skillRes.rows.map(s => [s.id, s]))
  const parties = new Map<number, string>(
    partyRes.rows.filter(p => p.name).map(p => [p.id, p.name as string]),
  )

  return { ...buildOrdersTree(wos, indents, boqRes.rows, skills, parties, absRes.rows), linked: true, error: null }
}

/**
 * The grouping, split from the fetch so every figure on this screen comes out
 * of a pure function with a test around it — the build order's rule: "Every
 * figure-producing function gets a test with a real IN4 case and its expected
 * rupee value." The NGH B numbers in orders-tree.test.ts are read from the
 * live mirror, not invented.
 */
export function buildOrdersTree(
  wos: WoRow[],
  indents: IndentRow[],
  boq: BoqRow[],
  skills: Map<number, Skill>,
  parties: Map<number, string>,
  abstracts: AbstractRow[] = [],
): Omit<OrdersTree, 'linked' | 'error'> {
  const nameOf = (id: number | null, fallback: string) =>
    id == null ? fallback : (skills.get(id)?.name ?? `${fallback} ${id}`)
  const codeOf = (id: number | null) => (id == null ? '￿' : (skills.get(id)?.code ?? String(id)))

  // Bills per line item, keyed on (wo_id, item_id). Oldest bill first, so
  // the list reads as the history of the line.
  const billsByLine = new Map<string, LineBill[]>()
  for (const a of abstracts) {
    const k = `${a.wo_id}:${a.item_id}`
    const arr = billsByLine.get(k) ?? []
    arr.push({
      billNo: a.display_no?.trim() || a.bill_no?.trim() || null,
      date: a.abstract_dt,
      qty: Number(a.executed_quantity ?? 0),
      amount: Number(a.executed_amt ?? 0),
    })
    billsByLine.set(k, arr)
  }
  for (const arr of billsByLine.values()) arr.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''))

  // BOQ lines by work order — the deepest level.
  const linesByWo = new Map<number, OrderLine[]>()
  for (const b of boq) {
    const arr = linesByWo.get(b.wo_id) ?? []
    const bills = billsByLine.get(`${b.wo_id}:${b.item_id}`) ?? []
    arr.push({
      id: `boq:${b.item_id}`,
      // boq_name is the heading IN4 groups by; the description is the full
      // specification. Show the shorter one as the label.
      name: b.boq_subname?.trim() || b.boq_name?.trim() || 'Item',
      description: b.description?.trim() || null,
      uom: b.uom?.trim() || null,
      qty: b.quantity != null ? Number(b.quantity) : null,
      rate: b.rate != null ? Number(b.rate) : null,
      amount: Number(b.amt ?? 0),
      certifiedQty: bills.length ? bills.reduce((s, x) => s + x.qty, 0) : null,
      certifiedAmt: bills.length ? bills.reduce((s, x) => s + x.amount, 0) : null,
      bills,
    })
    linesByWo.set(b.wo_id, arr)
  }

  interface CatAcc { name: string; code: string; subs: Map<string, OrdersSubRow> }
  const cats = new Map<string, CatAcc>()
  const catFor = (id: number | null) => {
    const key = id == null ? '_none' : String(id)
    let c = cats.get(key)
    if (!c) {
      c = {
        name: id == null ? 'No category in IN4' : nameOf(id, 'Category'),
        code: codeOf(id),
        subs: new Map(),
      }
      cats.set(key, c)
    }
    return { key, cat: c }
  }

  let woMissingSub = 0
  let discounted = 0
  let amended = 0

  // ── Work orders ─────────────────────────────────────────────────────────
  for (const w of wos) {
    const { key: ck, cat } = catFor(w.category_id)
    const hasSub = w.subcategory_id != null
    if (!hasSub) woMissingSub++
    const sk = hasSub ? `wo:${w.subcategory_id}` : 'wo:_nosub'
    let row = cat.subs.get(sk)
    if (!row) {
      row = {
        id: `${ck}::${sk}`,
        name: hasSub ? nameOf(w.subcategory_id, 'Sub-category') : 'No sub-category in IN4',
        code: hasSub ? codeOf(w.subcategory_id) : '',
        kind: 'wo', count: 0, ordered: 0, gross: 0, paid: 0, balance: 0, unassigned: !hasSub, orders: [],
      }
      cat.subs.set(sk, row)
    }
    const lines = linesByWo.get(w.wo_id) ?? []
    const ordered = Number(w.wo_value ?? 0)
    // IN4 holds gross = value on orders with no GST and value × 1.18 on the
    // rest; either way it is what the contractor bills, so it is the figure
    // Paid can be compared against. Missing gross falls back to the value —
    // the pre-fix behaviour — rather than to nothing.
    const gross = w.wo_gross_value != null ? Number(w.wo_gross_value) : ordered
    const paid = Number(w.wo_paid_amt ?? 0)
    const lineTotal = lines.reduce((s, l) => s + l.amount, 0)
    const billed = lines.filter(l => l.certifiedAmt != null)
    const certifiedAmt = billed.length ? billed.reduce((s, l) => s + (l.certifiedAmt ?? 0), 0) : null
    const lineNote = lineNoteFor(lines.length, lineTotal, ordered)
    if (lineNote?.includes('discount')) discounted++
    else if (lineNote) amended++
    row.orders.push({
      id: `wo:${w.wo_id}`,
      ref: w.display_no?.trim() || `WO ${w.wo_id}`,
      party: w.contractor_id != null ? (parties.get(w.contractor_id) ?? null) : null,
      kind: 'wo',
      ordered, gross, paid, balance: gross - paid,
      lines, lineTotal, certifiedAmt, lineNote,
    })
    row.count += 1
    row.ordered += ordered
    row.gross = (row.gross ?? 0) + gross
    row.paid = (row.paid ?? 0) + paid
    row.balance = (row.balance ?? 0) + (gross - paid)
  }

  // ── Purchase orders ─────────────────────────────────────────────────────
  // One order per DISTINCT po number within a category; its lines are the
  // indent lines that fed it.
  const poAcc = new Map<string, Map<string, OrderRow>>()   // catKey → poNo → order
  let draftLines = 0
  let draftAmount = 0

  for (const i of indents) {
    const arr = Array.isArray(i.pos) ? (i.pos as PoEntry[]) : []
    if (arr.length === 0) continue
    const { key: ck } = catFor(i.skill_id)
    for (const po of arr) {
      const amount = Number(po?.amount ?? 0)
      if (po?.draft) { draftLines++; draftAmount += amount; continue }
      const no = String(po?.poNo ?? '').trim() || '(no PO number)'
      const byNo = poAcc.get(ck) ?? new Map<string, OrderRow>()
      let order = byNo.get(no)
      if (!order) {
        order = {
          id: `po:${ck}:${no}`, ref: no,
          party: po?.supplier?.trim() || null,
          kind: 'po', ordered: 0, gross: null, paid: null, balance: null, lines: [], lineTotal: 0, certifiedAmt: null, lineNote: null,
        }
        byNo.set(no, order)
        poAcc.set(ck, byNo)
      }
      order.ordered += amount
      order.lineTotal += amount
      order.lines.push({
        id: `poline:${order.id}:${order.lines.length}`,
        name: i.material_name?.trim() || 'Material',
        description: null,
        uom: i.uom?.trim() || null,
        qty: po?.qty != null ? Number(po.qty) : null,
        rate: po?.rate != null ? Number(po.rate) : null,
        amount,
        // IN4's PO feed carries no GRN or bill per line, so nothing here.
        certifiedQty: null, certifiedAmt: null, bills: [],
      })
    }
  }
  for (const [ck, byNo] of poAcc) {
    const cat = cats.get(ck)
    if (!cat) continue
    const orders = [...byNo.values()].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
    cat.subs.set('po', {
      id: `${ck}::po`,
      name: 'Purchase orders',
      code: '',
      kind: 'po',
      count: orders.length,
      ordered: orders.reduce((s, o) => s + o.ordered, 0),
      gross: null,
      paid: null,
      balance: null,
      orders,
    })
  }

  // ── Shape, sequence, total ──────────────────────────────────────────────
  const out: OrdersCatRow[] = [...cats.entries()].map(([key, c]) => {
    const subs = [...c.subs.values()]
      .map(s => ({
        ...s,
        orders: s.orders.slice().sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true })),
      }))
      .sort((a, b) => rankOf(a) - rankOf(b) || byCode(a.code, b.code))
    // Gross, Paid and Balance are known for work orders only, so at category
    // level they sum the WO sub-rows and stay null when the category is all
    // purchase orders — a dash, never a zero that looks like "fully paid".
    const paidKnown = subs.some(s => s.paid != null)
    return {
      id: key,
      name: c.name,
      code: c.code,
      subs,
      count: subs.reduce((s, r) => s + r.count, 0),
      ordered: subs.reduce((s, r) => s + r.ordered, 0),
      gross: paidKnown ? subs.reduce((s, r) => s + (r.gross ?? 0), 0) : null,
      paid: paidKnown ? subs.reduce((s, r) => s + (r.paid ?? 0), 0) : null,
      balance: paidKnown ? subs.reduce((s, r) => s + (r.balance ?? 0), 0) : null,
    }
  }).sort((a, b) => byCode(a.code, b.code))

  const poNumbers = new Set<string>()
  for (const byNo of poAcc.values()) for (const no of byNo.keys()) poNumbers.add(no)

  const totals = {
    ordered: out.reduce((s, c) => s + c.ordered, 0),
    gross: out.reduce((s, c) => s + (c.gross ?? 0), 0),
    paid: out.reduce((s, c) => s + (c.paid ?? 0), 0),
    balance: out.reduce((s, c) => s + (c.balance ?? 0), 0),
    woCount: wos.length,
    poCount: poNumbers.size,
    lineCount: out.reduce((s, c) => s + c.subs.reduce((t, r) => t + r.orders.reduce((u, o) => u + o.lines.length, 0), 0), 0),
  }

  const notes: string[] = [
    'Rows follow IN4’s own code order — the same sequence as the Internal Estimate, not biggest-first.',
    'Work orders carry a category and a sub-category in IN4. Purchase orders carry only a category, '
    + 'so they sit on one row per category rather than under a sub-category IN4 never assigned.',
  ]
  if (woMissingSub > 0) {
    notes.push(
      `${woMissingSub} work order${woMissingSub === 1 ? ' has' : 's have'} no sub-category in IN4. `
      + 'They are on their own row so their value still reaches the total.',
    )
  }
  if (draftLines > 0) {
    notes.push(
      `${draftLines} draft purchase-order line${draftLines === 1 ? '' : 's'} `
      + `(₹${Math.round(draftAmount).toLocaleString('en-IN')}) `
      + 'are excluded — a draft is not a committed order.',
    )
  }
  notes.push(
    'Ordered is the order value before GST — the line items add up to it. "Incl. GST" is the same order as the '
    + 'contractor bills it. Paid is IN4’s own figure on the work-order record and includes GST, so Balance is '
    + 'Incl. GST minus Paid: both sides with tax. Subtracting Paid from the before-tax figure made paid-up orders look overpaid.',
  )
  notes.push(
    'Under each work order the line items show what has been CERTIFIED so far — quantity and amount summed over its bills, '
    + 'as IN4 records them, joined line to line. IN4 records payment per bill, not per item, so the item-wise figure is '
    + 'work billed and passed, before GST; Paid on the order row is the actual money, after GST, retention and recoveries. '
    + 'A dash means IN4 holds no bill against that line yet.',
  )
  notes.push('Incl. GST, Paid and Balance are held against work orders only. IN4’s purchase-order feed carries neither, so those columns are blank on PO rows and a category’s figures cover its work orders.')
  if (discounted > 0 || amended > 0) {
    const parts: string[] = []
    if (discounted > 0) parts.push(`${discounted} carr${discounted === 1 ? 'ies' : 'y'} a discount in IN4`)
    if (amended > 0) parts.push(`${amended} ${amended === 1 ? 'was' : 'were'} amended in IN4`)
    notes.push(
      `On ${discounted + amended} work order${discounted + amended === 1 ? '' : 's'} the line items do not add up to the order value: `
      + parts.join(' and ') + '. The row says which. Both figures are exactly as IN4 holds them.',
    )
  }

  return { cats: out, totals, notes }
}

/** Why an order's line items do not add up to its value, in IN4's own terms.
 *  Lines above the value: IN4 applied a discount (WO/SRJT/SRAH/2025-26/41 is
 *  13.98 %). Lines below: the order was amended and IN4's header and BOQ no
 *  longer agree (WO/SRASSK/DAE/2023-24/75). Within a rupee: no note. */
export function lineNoteFor(lineCount: number, lineTotal: number, ordered: number): string | null {
  if (lineCount === 0 || Math.abs(lineTotal - ordered) <= 1) return null
  const lines = formatINR(lineTotal)
  if (lineTotal > ordered) {
    const pct = ((lineTotal - ordered) / lineTotal) * 100
    const shown = Number.isInteger(Math.round(pct * 100) / 100) ? String(Math.round(pct)) : pct.toFixed(2)
    return `Line items total ${lines}; the order value is after a ${shown}% discount in IN4.`
  }
  return `Line items total ${lines}; the order was amended in IN4 and its value no longer equals its lines.`
}
