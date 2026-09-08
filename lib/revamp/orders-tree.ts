// Budget vs Actual, pill 2 — "Category — WO/PO wise" (build order §2/§3).
//
// The orders tree, four levels deep, on the SAME spine as the Internal
// Estimate so a figure here traces to the same row there:
//
//   category → sub-category → order → line item → bill
//
// Everything is IN4's own figure. The only derived one is Balance, a
// subtraction of amounts IN4 holds (§10), and it says so on the page.
//
// ── MONEY, as Aksha settled it on 8 Sept 2026 ──────────────────────────────
//
//   Ordered   the FULL order: a work order with GST (WO_GROSS_VALUE); a
//             purchase order with GST, freight, handling and other charges
//             (PO_VALUE). The before-tax value is kept beside it because the
//             line items add up to THAT, and a reader must be able to see the
//             two tie.
//   Billed    work certified so far, with GST (TOT_CERTIFIED_AMT).
//   Paid      money out: payments against bills + advances paid, and TDS
//             deducted at source COUNTS AS PAID — it is the contractor's money,
//             remitted on their behalf. (IN4's WO_ADVANCE_PAID_AMT already
//             includes the TDS on advances; the TDS on bills is summed from
//             the bill certificates.)
//   Adv. o/s  advance paid and not yet recovered against bills
//             (WO_ADVANCE_PAID_AMT − WO_ADVANCE_RECOVERED_AMT, which IN4 also
//             stores as WO_ADVANCE_BALANCE_AMT — identical on all 1,669 orders).
//   Retention held back from bills, its own column — released at the end,
//             so it is neither paid nor owed-now.
//   Balance   Ordered − Paid − Retention: what will still leave the account
//             before retention release. Checked two ways on
//             WO/SRJT/SRAH/2025-26/41: 2,80,49,086 − 2,26,08,542 − 9,55,444
//             = 44,85,100 = (yet to bill 1,28,66,308) − (advance o/s 83,81,208).
//
// The first cut subtracted Paid (with GST) from Ordered (without) and showed
// 353 of 1,670 orders as overpaid. IN4's own WO_BALANCE_AMT is zero on every
// order, so it cannot be used; Balance is computed here and labelled as such.
//
// ── WHERE THE FIGURES COME FROM ─────────────────────────────────────────────
//
// The mirror (in4_work_orders, in4_wo_boq_items, in4_wo_abstract_items,
// in4_indent_items, in4_wo_certificates, in4_supplier_certificates) carries
// the tree's shape, the line items, the bills per line and the TDS. It does
// NOT carry the order-level header figures (billed, advance paid/recovered,
// retention) or a purchase order's full value — the tracker feed keeps only
// qty × rate, which understates POs by about 17 % across the 1,442 in IN4.
// Those come LIVE from IN4 when the page opens (BI.FACT_ENGG_WORK_ORDER and
// BI.PURCHASE_ORDER_HEADER), read-only, the same way the printed work order
// does. If IN4 cannot be reached the tree still renders from the mirror and
// says which columns are blank and why — never a zero in their place.
//
// ── WHAT THE DATA ACTUALLY LOOKS LIKE, checked before building ─────────────
//
// 1. A work order carries BOTH `category_id` and `subcategory_id`, both into
//    `in4_skills` (a two-level tree; parent_id 0 = category).
// 2. A purchase order does NOT. An indent line carries a single `skill_id`,
//    a TOP-LEVEL category. So POs sit at category level.
// 3. Some work orders have NO sub-category. They get a stated row.
// 4. `pos` is a JSON ARRAY and a line can carry TWO purchase orders. Always
//    unnest; `pos->0` silently loses the second.
// 5. PO lines resolve to far fewer distinct PO numbers. Count numbers; sum lines.
// 6. Draft POs are not committed orders: out of the totals, said out loud.
// 7. `in4_parties` is keyed on (kind, id) — see contractorNames().
// 8. BOQ lines sum to WO_VALUE on 1,666 of 1,670 orders. The other four are
//    IN4 discounts (three) and an amendment (one) — said on the row.
// 9. Bills are joined to lines on (wo_id, item_id), never boq_id: the two IN4
//    facts disagree on BOQ_ID by one. WO 623 item 6340 = 95.17 %, as IN4 says.

import { formatINR } from '@/lib/utils'
import { createClient } from '@/lib/supabase/server'
import { in4Query, in4Config } from '@/lib/in4/db'

/** One bill (IN4 "abstract" / certificate) against one line item. */
export interface LineBill {
  /** The contractor's bill number as IN4 recorded it, cleaned of IN4's
   *  "TAX INVOICE NO :" prefix and "/Dt-…" suffix. Null when IN4 holds none
   *  (210 of 8,248 rows), in which case the abstract number is all there is. */
  billNo: string | null
  /** IN4's own abstract reference ("Abs/SRASSK/NGH/2024-25/7") — the internal
   *  certificate number, not the bill. Shown only when there is no bill number,
   *  and labelled as an abstract so nobody reads it as one. */
  abstractNo: string | null
  date: string | null
  qty: number
  amount: number
  /** Running total of qty up to and including this bill, oldest first. */
  cumQty: number
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
   *  to be a measurement. */
  certifiedQty: number | null
  certifiedAmt: number | null
  bills: LineBill[]
}

/** The money columns every level of the tree carries. Null = IN4 holds no
 *  figure for this row (a PO's billed, an all-PO category's retention, or
 *  every header column when IN4 could not be reached) — a dash on screen. */
export interface Money {
  /** Before-tax order value. The line items add up to this. */
  ordered: number
  /** The FULL order — with GST (WO) or with GST, freight and charges (PO). */
  gross: number | null
  billed: number | null
  paid: number | null
  advanceOutstanding: number | null
  retention: number | null
  balance: number | null
}

export interface OrderRow extends Money {
  id: string
  /** WO number or PO number, as IN4 writes it. */
  ref: string
  party: string | null
  kind: 'wo' | 'po'
  /** How the full amount is made up, in IN4's own parts — "before GST
   *  ₹x · GST ₹y" or "material ₹a · GST ₹b · freight ₹c". Null when the
   *  header was not available. */
  breakup: string | null
  lines: OrderLine[]
  /** Sum of the line items, kept so a reader can see when it does NOT equal
   *  Ordered and why (see lineNote). */
  lineTotal: number
  /** Sum of the lines' certified amounts (before GST); null when no line has
   *  a bill. */
  certifiedAmt: number | null
  /** Set only when the lines do not add up to the order value: IN4 applied a
   *  discount (lines above value) or the order was amended (lines below). */
  lineNote: string | null
  /** A one-line fact about the IN4 record that a reader needs to interpret
   *  the row: a PO whose bills IN4 booked under another PO's number, or a WO
   *  number IN4 has given to two orders. Null for the ordinary case. */
  flag: string | null
}

export interface OrdersSubRow extends Money {
  id: string
  name: string
  /** IN4's sequence code, used for ordering and shown nowhere else. */
  code: string
  kind: 'wo' | 'po'
  count: number
  unassigned?: boolean
  orders: OrderRow[]
}

export interface OrdersCatRow extends Money {
  id: string
  name: string
  code: string
  subs: OrdersSubRow[]
  count: number
}

export interface OrdersTree {
  cats: OrdersCatRow[]
  totals: Money & { woCount: number; poCount: number; lineCount: number }
  notes: string[]
  /** Whether the order-level header figures came from IN4 just now. */
  in4: 'live' | 'unavailable' | 'not-configured'
  linked: boolean
  error: string | null
}

const ZERO_MONEY: Money = { ordered: 0, gross: 0, billed: 0, paid: 0, advanceOutstanding: 0, retention: 0, balance: 0 }

const EMPTY: OrdersTree = {
  cats: [], totals: { ...ZERO_MONEY, woCount: 0, poCount: 0, lineCount: 0 },
  notes: [], in4: 'unavailable', linked: false, error: null,
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
  /** The GRNs (goods received) against this indent line, as the tracker feed
   *  stores them. A GRN is tied to a PO in IN4, but this list is per LINE, so
   *  it can only be shown under a PO when the line has exactly one. */
  grns?: unknown
}
export interface PoEntry {
  poNo?: string; amount?: number; draft?: boolean; qty?: number; rate?: number; supplier?: string
  /** Quantity received against THIS PO on this line — attributed by the feed
   *  through IN4's PO_DETAIL_ID, so it is right even when the line has two POs. */
  grnQty?: number
}
export interface GrnEntry { grnNo?: string; grnDate?: string; qty?: number; rate?: number; value?: number }

export interface Skill { id: number; name: string | null; code: string | null }

/** IN4's own header figures for one work order (BI.FACT_ENGG_WORK_ORDER).
 *  Deliberately NOT its TOT_CERTIFIED_AMT: that field counts cancelled bills
 *  (WO/SRASSK/NGH/2024-25/270 carries 1,09,17,089 of cancelled certificates
 *  inside it and so showed Billed above Ordered). Billed is summed from the
 *  bill certificates themselves, skipping rejected and cancelled — the same
 *  rule lib/in4/compute.ts applies for the budget report. The header's
 *  retention and advance figures already exclude cancelled bills. */
export interface WoHeader {
  gross: number
  /** WO_PAID_AMT — payments against bills, after TDS and retention. */
  billsPaid: number
  /** WO_ADVANCE_PAID_AMT — advances as billed, i.e. including their TDS. */
  advancePaid: number
  advanceRecovered: number
  retention: number
}
/** IN4's own header for one purchase order (BI.PURCHASE_ORDER_HEADER). */
export interface PoHeader {
  poId: number
  /** PO_VALUE — the full order with tax, freight, handling and charges. */
  value: number
  material: number
  tax: number
  freight: number
  handling: number
  other: number
  /** PAID_AMT — payments to the supplier, after TDS. */
  paid: number
}
/** A purchase order's supplier money. `billed` is the landed cost of the
 *  supplier's bills — material with GST — the PO-side twin of a work order's
 *  certified gross.
 *
 *  Bills are attributed to a PO through the GRN on each payment row, NOT the
 *  PO number IN4 stamps on the bill's header. One supplier bill can cover two
 *  same-day POs (Naturoprotect's bill 1229 covered PO 92 and PO 93 on NGH);
 *  IN4 puts the whole bill under one of them at the header, so its own PO
 *  screen shows PO 92 unpaid and PO 93 overpaid by 90,683. The GRN rows say
 *  which PO each rupee belongs to: 73 such bills, 90 POs, 73.8 lakh. Where
 *  that happened, `bookedUnder` names the PO IN4's header used, so the page
 *  can say so rather than silently disagree with IN4. */
export interface PoCertAgg {
  billed: number
  /** Payments on the bills, after TDS — from the same GRN-placed rows as
   *  `billed`, never the header's PAID_AMT, which carries the same booking
   *  problem as the header's PO number. */
  paid: number
  tds: number; retention: number; advancePaid: number; advanceRecovered: number
  bookedUnder: string[]
}

/** One supplier-payment row from IN4, already joined to the PO its GRN
 *  belongs to (BI.FACT_PURCHASE_SUPPLIER_PAY ⋈ BI.FACT_PURCHASE_GRN_DETAILS). */
export interface SupplierPayRow {
  grnPoId: number
  billPoId: number
  billPoNo: string | null
  landed: number
  paid: number
  tds: number
  retention: number
  advanceRecovered: number
}

/** Fold payment rows into per-PO sums by the GRN's PO. Pure, so the
 *  two-POs-one-bill case is a test rather than a surprise. */
export function poPaymentsFromRows(rows: readonly SupplierPayRow[]): Map<number, PoCertAgg> {
  const out = new Map<number, PoCertAgg>()
  for (const r of rows) {
    const agg = out.get(r.grnPoId) ?? { billed: 0, paid: 0, tds: 0, retention: 0, advancePaid: 0, advanceRecovered: 0, bookedUnder: [] }
    agg.billed += r.landed
    agg.paid += r.paid
    agg.tds += r.tds
    agg.retention += r.retention
    agg.advanceRecovered += r.advanceRecovered
    if (r.billPoId !== r.grnPoId) {
      const label = r.billPoNo?.trim() || `PO id ${r.billPoId}`
      if (!agg.bookedUnder.includes(label)) agg.bookedUnder.push(label)
    }
    out.set(r.grnPoId, agg)
  }
  return out
}

/** Everything the pure builder needs beyond the mirror rows. Empty maps mean
 *  "IN4 not reached": header-derived columns come out null. */
export interface Sources {
  woHeaders: Map<number, WoHeader>
  /** Gross (with GST) of a work order's live bills — kind 'wo', not rejected
   *  or cancelled — from the mirror's certificates. */
  woBilled: Map<number, number>
  /** TDS deducted on those same bills. */
  woBillTds: Map<number, number>
  poHeaders: Map<string, PoHeader>
  poCerts: Map<number, PoCertAgg>
  in4: OrdersTree['in4']
  in4Error?: string
}
export const NO_SOURCES: Sources = {
  woHeaders: new Map(), woBilled: new Map(), woBillTds: new Map(), poHeaders: new Map(), poCerts: new Map(), in4: 'unavailable',
}

/** Certificate statuses the figures leave out — IN4's 3 = Rejected, 6 =
 *  Cancelled. Same set as lib/in4/compute.ts CERT_EXCLUDED. */
export const CERT_EXCLUDED = new Set([3, 6])

/** Where a row sits within its category, before its code is considered:
 *  the work-order sub-categories in IN4 order, then the purchase-order row,
 *  then the bucket for work orders IN4 never sub-categorised. Rank is
 *  explicit — a sort order should not depend on where a private-use
 *  character lands in a collation table, which is how the first cut broke. */
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

/** PostgREST caps a plain select at 1,000 rows and reports no error. Raj
 *  Uphaar has 4,102 BOQ lines and 3,502 bill lines. Paged, always. */
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

/** The distinct, non-draft PO numbers the indent lines point at. */
export function poNumbersOf(indents: ReadonlyArray<IndentRow>): string[] {
  const out = new Set<string>()
  for (const i of indents) {
    const arr = Array.isArray(i.pos) ? (i.pos as PoEntry[]) : []
    for (const po of arr) {
      if (po?.draft) continue
      const no = String(po?.poNo ?? '').trim()
      if (no) out.add(no)
    }
  }
  return [...out]
}

/** A PO number as a SQL string literal. IN4's numbers look like
 *  "PO/SRASSK/NGH/2025-26/12"; anything outside that alphabet is dropped
 *  rather than escaped, because a PO number is never a place for a quote. */
export function sqlLiteral(s: string): string | null {
  if (!/^[A-Za-z0-9/_\-. ]{1,60}$/.test(s)) return null
  return `'${s.replace(/'/g, "''")}'`
}

/** Read the order-level figures live from IN4. Never throws: a failure
 *  becomes `in4: 'unavailable'` with the message, and the tree renders from
 *  the mirror with those columns blank. SELECT only, chunked so the IN list
 *  stays short. */
async function readIn4Headers(woIds: number[], poNos: string[]): Promise<Pick<Sources, 'woHeaders' | 'poHeaders' | 'in4' | 'in4Error'>> {
  const woHeaders = new Map<number, WoHeader>()
  const poHeaders = new Map<string, PoHeader>()
  if (!in4Config()) return { woHeaders, poHeaders, in4: 'not-configured' }
  const n = (v: unknown) => (v == null ? 0 : Number(v))
  try {
    for (let i = 0; i < woIds.length; i += 500) {
      const chunk = woIds.slice(i, i + 500).filter(Number.isInteger)
      if (!chunk.length) continue
      const rows = await in4Query<Record<string, unknown>>(`
        SELECT WO_ID, WO_GROSS_VALUE, WO_PAID_AMT, WO_ADVANCE_PAID_AMT, WO_ADVANCE_RECOVERED_AMT, WO_RETENTION_AMT
        FROM BI.FACT_ENGG_WORK_ORDER WHERE WO_ID IN (${chunk.join(',')})`)
      for (const r of rows) {
        woHeaders.set(n(r.WO_ID), {
          gross: n(r.WO_GROSS_VALUE), billsPaid: n(r.WO_PAID_AMT),
          advancePaid: n(r.WO_ADVANCE_PAID_AMT), advanceRecovered: n(r.WO_ADVANCE_RECOVERED_AMT), retention: n(r.WO_RETENTION_AMT),
        })
      }
    }
    const lits = poNos.map(sqlLiteral).filter((s): s is string => s != null)
    for (let i = 0; i < lits.length; i += 300) {
      const chunk = lits.slice(i, i + 300)
      const rows = await in4Query<Record<string, unknown>>(`
        SELECT PO_ID, PO_NO, PO_VALUE, PO_MATERIAL_VALUE, PO_TAX_ADDITIONS, PO_FREIGHT_CHARGES, PO_HANDLING_CHARGE, PO_OTHER_CHARGES, PAID_AMT
        FROM BI.PURCHASE_ORDER_HEADER WHERE PO_NO IN (${chunk.join(',')})`)
      for (const r of rows) {
        poHeaders.set(String(r.PO_NO ?? '').trim(), {
          poId: n(r.PO_ID), value: n(r.PO_VALUE), material: n(r.PO_MATERIAL_VALUE), tax: n(r.PO_TAX_ADDITIONS),
          freight: n(r.PO_FREIGHT_CHARGES), handling: n(r.PO_HANDLING_CHARGE), other: n(r.PO_OTHER_CHARGES), paid: n(r.PAID_AMT),
        })
      }
    }
    return { woHeaders, poHeaders, in4: 'live' }
  } catch (e) {
    return { woHeaders, poHeaders, in4: 'unavailable', in4Error: e instanceof Error ? e.message : String(e) }
  }
}

/** Supplier payments for a set of POs, each row placed under the PO its GRN
 *  belongs to. Bills spanning two POs come back as two rows with the bill's
 *  header PO named, so the page can say where IN4 booked it. Null on failure
 *  (the caller then leaves the PO money blank). */
async function readIn4PoPayments(poIds: number[]): Promise<SupplierPayRow[] | null> {
  const rows: SupplierPayRow[] = []
  const n = (v: unknown) => (v == null ? 0 : Number(v))
  try {
    for (let i = 0; i < poIds.length; i += 500) {
      const chunk = poIds.slice(i, i + 500).filter(Number.isInteger)
      if (!chunk.length) continue
      const got = await in4Query<Record<string, unknown>>(`
        WITH g AS (SELECT DISTINCT GRN_ID, PO_ID FROM BI.FACT_PURCHASE_GRN_DETAILS)
        SELECT g.PO_ID GRN_PO_ID, p.PO_ID BILL_PO_ID, h.PO_NO BILL_PO_NO,
               SUM(p.LANDED_COST) LANDED, SUM(p.PAID_AMT) PAID, SUM(p.TAX_DEDUCTION_AMT) TDS,
               SUM(p.RETENTION_AMT) RETENTION, SUM(p.ADV_RECOVERY_AMT) ADV_RECOVERY
        FROM BI.FACT_PURCHASE_SUPPLIER_PAY p
        JOIN g ON g.GRN_ID = p.GRN_ID
        LEFT JOIN BI.PURCHASE_ORDER_HEADER h ON h.PO_ID = p.PO_ID
        WHERE g.PO_ID IN (${chunk.join(',')})
        GROUP BY g.PO_ID, p.PO_ID, h.PO_NO`)
      for (const r of got) {
        rows.push({
          grnPoId: n(r.GRN_PO_ID), billPoId: n(r.BILL_PO_ID), billPoNo: r.BILL_PO_NO == null ? null : String(r.BILL_PO_NO),
          landed: n(r.LANDED), paid: n(r.PAID), tds: n(r.TDS), retention: n(r.RETENTION), advanceRecovered: n(r.ADV_RECOVERY),
        })
      }
    }
    return rows
  } catch {
    return null
  }
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
      .select('indent_item_id, skill_id, material_name, uom, pos, grns')
      .in('subproject_id', subIds).range(f, t)),
  ])
  if (woRes.error) return { ...EMPTY, linked: true, error: woRes.error }
  if (indentRes.error) return { ...EMPTY, linked: true, error: indentRes.error }

  const wos = woRes.rows
  const indents = indentRes.rows
  const woIds = wos.map(w => w.wo_id)
  const poNos = poNumbersOf(indents)

  const [boqRes, skillRes, partyRes, absRes, certRes, headers] = await Promise.all([
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
    contractorNames(supabase as unknown as PartyReader, wos),
    // Every bill line against these orders, joined to lines on (wo_id, item_id).
    woIds.length
      ? fetchAll<AbstractRow>((f, t) => supabase.from('in4_wo_abstract_items')
          .select('wo_id, item_id, executed_quantity, executed_amt, bill_no, display_no, abstract_dt')
          .in('wo_id', woIds).range(f, t))
      : Promise.resolve({ rows: [] as AbstractRow[], error: null }),
    // Each work order's bills: gross (with GST) for Billed, and the TDS on
    // them. Only the 'wo' kind — the TDS on advances is already inside
    // WO_ADVANCE_PAID_AMT — and only live bills (status filtered below).
    woIds.length
      ? fetchAll<CertRow>((f, t) => supabase.from('in4_wo_certificates')
          .select('wo_id, kind, status, gross_bill_amt, deductions').in('wo_id', woIds).range(f, t))
      : Promise.resolve({ rows: [] as CertRow[], error: null }),
    readIn4Headers(woIds, poNos),
  ])
  if (boqRes.error) return { ...EMPTY, linked: true, error: boqRes.error }
  if (absRes.error) return { ...EMPTY, linked: true, error: absRes.error }
  if (certRes.error) return { ...EMPTY, linked: true, error: certRes.error }
  if (skillRes.error) return { ...EMPTY, linked: true, error: skillRes.error }
  if (partyRes.error) return { ...EMPTY, linked: true, error: partyRes.error }

  const { woBilled, woBillTds } = billsFromCertificates(certRes.rows)

  // Supplier money for the POs IN4 just identified. Bills come live from IN4
  // attributed by GRN (see PoCertAgg); advances have no GRN and come from the
  // mirror's supplier certificates by PO id. Needs the PO ids, so it follows.
  let poCerts = new Map<number, PoCertAgg>()
  const poIds = [...headers.poHeaders.values()].map(h => h.poId)
  if (poIds.length) {
    const [payRows, adv] = await Promise.all([
      readIn4PoPayments(poIds),
      fetchAll<{ po_id: number; kind: string; paid: number | null; tax_deduction: number | null }>(
        (f, t) => supabase.from('in4_supplier_certificates').select('po_id, kind, paid, tax_deduction').eq('kind', 'advance').in('po_id', poIds).range(f, t)),
    ])
    if (adv.error) return { ...EMPTY, linked: true, error: adv.error }
    if (payRows) {
      poCerts = poPaymentsFromRows(payRows)
      for (const r of adv.rows) {
        const agg = poCerts.get(r.po_id) ?? { billed: 0, paid: 0, tds: 0, retention: 0, advancePaid: 0, advanceRecovered: 0, bookedUnder: [] }
        agg.advancePaid += Number(r.paid ?? 0) + Number(r.tax_deduction ?? 0)
        poCerts.set(r.po_id, agg)
      }
    }
  }

  const skills = new Map<number, Skill>(skillRes.rows.map(s => [s.id, s]))
  const parties = new Map<number, string>(
    partyRes.rows.filter(p => p.name).map(p => [p.id, p.name as string]),
  )
  const sources: Sources = { ...headers, woBilled, woBillTds, poCerts }

  return { ...buildOrdersTree(wos, indents, boqRes.rows, skills, parties, absRes.rows, sources), linked: true, error: null }
}

/** One row of in4_wo_certificates as the loader reads it. */
export interface CertRow { wo_id: number; kind: string; status: number | null; gross_bill_amt: number | null; deductions: number | null }

/** Billed and TDS per work order from its bill certificates: kind 'wo' only,
 *  rejected and cancelled left out. Pure, so the cancelled-bill case is
 *  tested rather than rediscovered on the page. */
export function billsFromCertificates(rows: readonly CertRow[]): { woBilled: Map<number, number>; woBillTds: Map<number, number> } {
  const woBilled = new Map<number, number>()
  const woBillTds = new Map<number, number>()
  for (const c of rows) {
    if (c.kind !== 'wo' || (c.status != null && CERT_EXCLUDED.has(c.status))) continue
    woBilled.set(c.wo_id, (woBilled.get(c.wo_id) ?? 0) + Number(c.gross_bill_amt ?? 0))
    woBillTds.set(c.wo_id, (woBillTds.get(c.wo_id) ?? 0) + Number(c.deductions ?? 0))
  }
  return { woBilled, woBillTds }
}

/**
 * A PO line IN4's tracker view repeated. PO/SRASSK/NGH/2025-26/93 holds ONE
 * line — 44,270 kg of Pidilite — but after its amendment the view lists that
 * line twice, against two indents (PO details 3726 and 4371), full quantity
 * both times, so the tree summed 88,540 kg and 11,73,155 for a 5,86,578
 * order. The receipts, by contrast, are split between the two: 44,200 kg
 * under one, 70 kg under the other. Lines with the same material, unit,
 * quantity and rate are therefore ONE line: ordered once, receipts added,
 * GRN rows brought together and de-duplicated. Mutates the order in place
 * and sets its flag. Pure otherwise, so the PO 93 case is a test.
 */
export function mergeRepeatedPoLines(o: OrderRow): void {
  if (o.kind !== 'po' || o.lines.length < 2) return
  // A repeat is the SAME line — material, unit, quantity, rate AND amount all
  // equal, and quantity and rate actually present. Three indent lines that
  // merely share a PO number and a material name are three lines.
  const groups = new Map<string, OrderLine[]>()
  for (const l of o.lines) {
    const k = l.qty != null && l.rate != null
      ? `${l.name}|${l.uom ?? ''}|${l.qty}|${l.rate}|${l.amount}`
      : `unique|${l.id}`
    const g = groups.get(k) ?? []
    g.push(l)
    groups.set(k, g)
  }
  if ([...groups.values()].every(g => g.length === 1)) return

  const merged: OrderLine[] = []
  let repeated = 0
  for (const g of groups.values()) {
    if (g.length === 1) { merged.push(g[0]); continue }
    repeated++
    const first = g[0]
    const qtys = g.map(l => l.certifiedQty).filter((v): v is number => v != null)
    const seen = new Set<string>()
    const bills: LineBill[] = []
    for (const l of g) for (const b of l.bills) {
      const key = `${b.billNo ?? ''}|${b.date ?? ''}|${b.qty}|${b.amount}`
      if (seen.has(key)) continue
      seen.add(key)
      bills.push({ ...b })
    }
    bills.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''))
    let run = 0
    for (const b of bills) { run += b.qty; b.cumQty = run }
    merged.push({
      ...first,
      certifiedQty: qtys.length ? qtys.reduce((s, v) => s + v, 0) : null,
      certifiedAmt: bills.length ? bills.reduce((s, b) => s + b.amount, 0) : null,
      bills,
    })
  }
  o.lines = merged
  o.ordered = merged.reduce((s, l) => s + l.amount, 0)
  o.lineTotal = o.ordered
  const f = `IN4 lists ${repeated === 1 ? 'a line of this PO' : `${repeated} lines of this PO`} against more than one indent; shown once here.`
  o.flag = o.flag ? `${o.flag} ${f}` : f
}

/** Sum a money column over rows, null when NO row carries it — a dash, never
 *  a zero that reads as "fully paid". */
function sumOrNull<T>(rows: readonly T[], pick: (r: T) => number | null): number | null {
  let any = false, s = 0
  for (const r of rows) { const v = pick(r); if (v != null) { any = true; s += v } }
  return any ? s : null
}
function rollUp<T extends Money>(rows: readonly T[]): Omit<Money, 'ordered'> & { ordered: number } {
  return {
    ordered: rows.reduce((s, r) => s + r.ordered, 0),
    gross: sumOrNull(rows, r => r.gross),
    billed: sumOrNull(rows, r => r.billed),
    paid: sumOrNull(rows, r => r.paid),
    advanceOutstanding: sumOrNull(rows, r => r.advanceOutstanding),
    retention: sumOrNull(rows, r => r.retention),
    balance: sumOrNull(rows, r => r.balance),
  }
}

/** "before GST ₹x · GST ₹y" — only the parts IN4 actually holds a value for. */
function breakupOf(parts: Array<[string, number]>): string | null {
  const shown = parts.filter(([, v]) => Math.abs(v) >= 1).map(([k, v]) => `${k} ${formatINR(v)}`)
  return shown.length ? shown.join(' · ') : null
}

/**
 * The grouping, split from the fetch so every figure on this screen comes out
 * of a pure function with a test around it — the build order's rule: "Every
 * figure-producing function gets a test with a real IN4 case and its expected
 * rupee value." The NGH B and SRAH numbers in orders-tree.test.ts are read
 * from the live mirror and from IN4, not invented.
 */
export function buildOrdersTree(
  wos: WoRow[],
  indents: IndentRow[],
  boq: BoqRow[],
  skills: Map<number, Skill>,
  parties: Map<number, string>,
  abstracts: AbstractRow[] = [],
  src: Sources = NO_SOURCES,
): Omit<OrdersTree, 'linked' | 'error'> {
  const nameOf = (id: number | null, fallback: string) =>
    id == null ? fallback : (skills.get(id)?.name ?? `${fallback} ${id}`)
  const codeOf = (id: number | null) => (id == null ? '￿' : (skills.get(id)?.code ?? String(id)))

  // Bills per line item, keyed on (wo_id, item_id). Oldest bill first, with a
  // running quantity, so the list reads as the history of the line.
  const billsByLine = new Map<string, LineBill[]>()
  for (const a of abstracts) {
    const k = `${a.wo_id}:${a.item_id}`
    const arr = billsByLine.get(k) ?? []
    arr.push({
      billNo: cleanBillNo(a.bill_no),
      abstractNo: a.display_no?.trim() || null,
      date: a.abstract_dt,
      qty: Number(a.executed_quantity ?? 0),
      amount: Number(a.executed_amt ?? 0),
      cumQty: 0,
    })
    billsByLine.set(k, arr)
  }
  for (const arr of billsByLine.values()) {
    arr.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''))
    let run = 0
    for (const b of arr) { run += b.qty; b.cumQty = run }
  }

  // BOQ lines by work order.
  const linesByWo = new Map<number, OrderLine[]>()
  for (const b of boq) {
    const arr = linesByWo.get(b.wo_id) ?? []
    const bills = billsByLine.get(`${b.wo_id}:${b.item_id}`) ?? []
    arr.push({
      id: `boq:${b.item_id}`,
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
      c = { name: id == null ? 'No category in IN4' : nameOf(id, 'Category'), code: codeOf(id), subs: new Map() }
      cats.set(key, c)
    }
    return { key, cat: c }
  }

  let woMissingSub = 0
  let discounted = 0
  let amended = 0
  let woWithoutHeader = 0
  let duplicateNos = 0

  // IN4 has given the same work-order number to two orders on five occasions
  // (WO/SRET/RU/2023-24/17, 18, 19, 21, 22 — different orders, different
  // values). Both rows show, keyed on IN4's own id; each says so.
  const noCount = new Map<string, number>()
  for (const w of wos) {
    const no = w.display_no?.trim()
    if (no) noCount.set(no, (noCount.get(no) ?? 0) + 1)
  }

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
        kind: 'wo', count: 0, ...ZERO_MONEY, unassigned: !hasSub, orders: [],
      }
      cat.subs.set(sk, row)
    }
    const lines = linesByWo.get(w.wo_id) ?? []
    const ordered = Number(w.wo_value ?? 0)
    const lineTotal = lines.reduce((s, l) => s + l.amount, 0)
    const billedLines = lines.filter(l => l.certifiedAmt != null)
    const certifiedAmt = billedLines.length ? billedLines.reduce((s, l) => s + (l.certifiedAmt ?? 0), 0) : null
    const lineNote = lineNoteFor(lines.length, lineTotal, ordered)
    if (lineNote?.includes('discount')) discounted++
    else if (lineNote) amended++

    const h = src.woHeaders.get(w.wo_id)
    // The full amount: IN4's header first; the mirror's own gross when IN4
    // is not reachable (it is the same column, one sync older).
    const gross = h ? h.gross : (w.wo_gross_value != null ? Number(w.wo_gross_value) : null)
    let money: Omit<Money, 'ordered' | 'gross'>
    let breakup: string | null = null
    if (h) {
      const tds = src.woBillTds.get(w.wo_id) ?? 0
      const paid = h.billsPaid + tds + h.advancePaid
      money = {
        // No live bill against the order = nothing billed, which is a fact
        // (unlike a missing header, which is a gap).
        billed: src.woBilled.get(w.wo_id) ?? 0,
        paid,
        advanceOutstanding: h.advancePaid - h.advanceRecovered,
        retention: h.retention,
        balance: h.gross - paid - h.retention,
      }
      breakup = breakupOf([['before GST', ordered], ['GST', h.gross - ordered]])
    } else {
      woWithoutHeader++
      money = { billed: null, paid: null, advanceOutstanding: null, retention: null, balance: null }
    }

    const ref = w.display_no?.trim() || `WO ${w.wo_id}`
    const dup = (noCount.get(ref) ?? 0) > 1
    if (dup) duplicateNos++
    const order: OrderRow = {
      id: `wo:${w.wo_id}`,
      ref,
      party: w.contractor_id != null ? (parties.get(w.contractor_id) ?? null) : null,
      kind: 'wo',
      ordered, gross, ...money, breakup,
      lines, lineTotal, certifiedAmt, lineNote,
      flag: dup ? 'IN4 has given this number to two different work orders.' : null,
    }
    row.orders.push(order)
    row.count += 1
  }

  // ── Purchase orders ─────────────────────────────────────────────────────
  // One order per DISTINCT po number within a category; its lines are the
  // indent lines that fed it. The tracker holds qty × rate per line (the
  // material value); the FULL value with tax and freight is IN4's header.
  const poAcc = new Map<string, Map<string, OrderRow>>()   // catKey → poNo → order
  let draftLines = 0
  let draftAmount = 0
  let poWithoutHeader = 0
  let multiPoLines = 0
  let bookedElsewhere = 0
  let repeatedPoLines = 0

  for (const i of indents) {
    const arr = Array.isArray(i.pos) ? (i.pos as PoEntry[]) : []
    if (arr.length === 0) continue
    const { key: ck } = catFor(i.skill_id)
    // The GRNs on this line belong to ONE of its POs; the feed only tells us
    // which through grnQty per PO. When the line has a single live PO the
    // GRN list is that PO's; with two, only the quantity can be placed.
    const livePos = arr.filter(p => !p?.draft)
    const grnList: GrnEntry[] = Array.isArray(i.grns) ? (i.grns as GrnEntry[]) : []
    const singlePo = livePos.length === 1
    if (livePos.length > 1 && grnList.length > 0) multiPoLines++
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
          kind: 'po', ...ZERO_MONEY, gross: null, billed: null, paid: null, advanceOutstanding: null, retention: null, balance: null,
          breakup: null, lines: [], lineTotal: 0, certifiedAmt: null, lineNote: null, flag: null,
        }
        byNo.set(no, order)
        poAcc.set(ck, byNo)
      }
      order.ordered += amount
      order.lineTotal += amount
      // Received against this PO line. grnQty is attributed per PO by the
      // feed; the GRN rows (number, date, qty, landed value) can be listed
      // only when this is the line's one PO. Absent grnQty = nothing received
      // yet = null, not zero.
      const receivedQty = po?.grnQty != null && po.grnQty > 0 ? Number(po.grnQty) : null
      // IN4's tracker view joins EVERY GRN of a PO to EVERY indent line of
      // that PO; the GRN fact then has a quantity for only one of them, so
      // the others come through as GRN rows of 0 kg. A receipt of nothing is
      // not a receipt — those rows are dropped.
      const grns: LineBill[] = singlePo
        ? grnList
            .filter(g => Number(g.qty ?? 0) > 0 || Number(g.value ?? 0) > 0)
            .map(g => ({ billNo: g.grnNo?.trim() || null, abstractNo: null, date: g.grnDate ?? null, qty: Number(g.qty ?? 0), amount: Number(g.value ?? 0), cumQty: 0 }))
        : []
      grns.sort((x, y) => (x.date ?? '').localeCompare(y.date ?? ''))
      let run = 0
      for (const g of grns) { run += g.qty; g.cumQty = run }
      order.lines.push({
        id: `poline:${order.id}:${order.lines.length}`,
        name: i.material_name?.trim() || 'Material',
        description: null,
        uom: i.uom?.trim() || null,
        qty: po?.qty != null ? Number(po.qty) : null,
        rate: po?.rate != null ? Number(po.rate) : null,
        amount,
        certifiedQty: receivedQty,
        // Landed value of the receipts (GST included), when they can be tied
        // to this PO. Quantity alone otherwise.
        certifiedAmt: grns.length ? grns.reduce((s, g) => s + g.amount, 0) : null,
        bills: grns,
      })
    }
  }
  for (const [ck, byNo] of poAcc) {
    const cat = cats.get(ck)
    if (!cat) continue
    const orders = [...byNo.values()].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
    for (const o of orders) {
      mergeRepeatedPoLines(o)
      if (o.flag) repeatedPoLines++
      const received = o.lines.filter(l => l.certifiedAmt != null)
      o.certifiedAmt = received.length ? received.reduce((s, l) => s + (l.certifiedAmt ?? 0), 0) : null
      const h = src.poHeaders.get(o.ref)
      if (!h) { poWithoutHeader++; continue }
      const c = src.poCerts.get(h.poId)
      // Same money-out rule as a work order: bill payments + TDS (counted as
      // paid) + advances paid. All from rows placed by GRN — the header's
      // PAID_AMT would put PO 92's money on PO 93.
      const paid = c ? c.paid + c.tds + c.advancePaid : 0
      const retention = c?.retention ?? 0
      o.gross = h.value
      o.billed = c ? c.billed : null
      o.paid = paid
      o.retention = retention
      o.advanceOutstanding = c ? c.advancePaid - c.advanceRecovered : 0
      o.balance = h.value - paid - retention
      if (c && c.bookedUnder.length) {
        bookedElsewhere++
        const f = `IN4 booked ${c.bookedUnder.length === 1 ? 'a bill' : 'bills'} for this PO under ${c.bookedUnder.join(', ')}; shown here by its GRNs.`
        o.flag = o.flag ? `${o.flag} ${f}` : f
      }
      o.breakup = breakupOf([['material', h.material], ['GST', h.tax], ['freight', h.freight], ['handling', h.handling], ['other', h.other]])
    }
    cat.subs.set('po', {
      id: `${ck}::po`, name: 'Purchase orders', code: '', kind: 'po',
      count: orders.length, ...rollUp(orders), orders,
    })
  }

  // ── Shape, sequence, total ──────────────────────────────────────────────
  const out: OrdersCatRow[] = [...cats.entries()].map(([key, c]) => {
    const subs = [...c.subs.values()]
      .map(s => {
        const orders = s.orders.slice().sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
        return { ...s, orders, ...rollUp(orders) }
      })
      .sort((a, b) => rankOf(a) - rankOf(b) || byCode(a.code, b.code))
    return { id: key, name: c.name, code: c.code, subs, count: subs.reduce((s, r) => s + r.count, 0), ...rollUp(subs) }
  }).sort((a, b) => byCode(a.code, b.code))

  const poNumbers = new Set<string>()
  for (const byNo of poAcc.values()) for (const no of byNo.keys()) poNumbers.add(no)

  const r = rollUp(out)
  const totals = {
    ordered: r.ordered, gross: r.gross ?? 0, billed: r.billed ?? 0, paid: r.paid ?? 0,
    advanceOutstanding: r.advanceOutstanding ?? 0, retention: r.retention ?? 0, balance: r.balance ?? 0,
    woCount: wos.length,
    poCount: poNumbers.size,
    lineCount: out.reduce((s, c) => s + c.subs.reduce((t, x) => t + x.orders.reduce((u, o) => u + o.lines.length, 0), 0), 0),
  }

  const notes: string[] = [
    'Rows follow IN4’s own code order — the same sequence as the Internal Estimate, not biggest-first.',
    'Work orders carry a category and a sub-category in IN4. Purchase orders carry only a category, '
    + 'so they sit on one row per category rather than under a sub-category IN4 never assigned.',
  ]
  if (src.in4 === 'live') {
    notes.push(
      'Ordered is the full order — with GST for a work order; with GST, freight, handling and other charges for a purchase order — '
      + 'read live from IN4’s order record when this page opened. The before-tax value sits under it; the line items add up to that.',
    )
    notes.push(
      'Paid is money out: payments against bills plus advances paid, and TDS deducted at source counts as paid — it is the contractor’s money, '
      + 'remitted on their behalf. Retention held back is its own column. Balance is Ordered − Paid − Retention: what will still leave the '
      + 'account before retention is released. It is the one figure here that is arithmetic rather than a value IN4 holds.',
    )
    notes.push('Adv. o/s is advance paid and not yet recovered against bills — IN4’s own WO_ADVANCE_BALANCE_AMT, which equals paid − recovered on every order.')
  } else {
    notes.push(
      src.in4 === 'not-configured'
        ? 'This deployment has no IN4 login, so the order-level figures (Billed, Paid, Adv. o/s, Retention, Balance) are blank. Ordered shows the mirror’s last-synced gross.'
        : `IN4 could not be reached when this page opened${src.in4Error ? ` (${src.in4Error})` : ''}, so Billed, Paid, Adv. o/s, Retention and Balance are blank rather than stale. Ordered shows the mirror’s last-synced gross.`,
    )
  }
  if (src.in4 === 'live' && (woWithoutHeader > 0 || poWithoutHeader > 0)) {
    const parts: string[] = []
    if (woWithoutHeader > 0) parts.push(`${woWithoutHeader} work order${woWithoutHeader === 1 ? '' : 's'}`)
    if (poWithoutHeader > 0) parts.push(`${poWithoutHeader} purchase order${poWithoutHeader === 1 ? '' : 's'}`)
    notes.push(`IN4 returned no order record for ${parts.join(' and ')} in the mirror; their header columns are blank.`)
  }
  if (repeatedPoLines > 0) {
    notes.push(
      `When a purchase order is amended, or one PO line serves two indents, IN4’s tracker view repeats the PO line — full quantity each time — against `
      + `every indent it touches. On ${repeatedPoLines} PO${repeatedPoLines === 1 ? '' : 's'} here such lines are shown once, with their receipts brought together, and the row says so.`,
    )
  }
  if (bookedElsewhere > 0) {
    notes.push(
      `A supplier’s bill can cover two purchase orders; IN4 books the whole bill under one PO number at the header. On ${bookedElsewhere} `
      + `PO${bookedElsewhere === 1 ? '' : 's'} here the money is placed by the GRN on each bill line instead, and the row says which PO IN4’s header used.`,
    )
  }
  if (duplicateNos > 0) {
    notes.push(`${duplicateNos} work-order row${duplicateNos === 1 ? '' : 's'} carr${duplicateNos === 1 ? 'ies' : 'y'} a number IN4 has also given to another order. Both are shown; each is marked.`)
  }
  notes.push(
    'Under each purchase order the line items show what has been RECEIVED so far — the GRN quantity against that PO, and the GRNs '
    + 'themselves with their landed value (GST included). Billed on a PO row is the landed cost of the supplier’s bills.'
    + (multiPoLines > 0
      ? ` On ${multiPoLines} line${multiPoLines === 1 ? '' : 's'} the indent was split across two POs; IN4 ties each GRN to a PO but the mirror keeps the list per line, so those show received quantity only.`
      : ''),
  )
  notes.push(
    'Under each work order the line items show what has been CERTIFIED so far — quantity and amount over its bills, joined line to line — '
    + 'and each line opens to its bills with a running quantity against the ordered quantity. IN4 records payment per bill, not per item, so '
    + 'the item-wise figure is work billed before GST; Paid on the order row is the money.',
  )
  if (woMissingSub > 0) {
    notes.push(
      `${woMissingSub} work order${woMissingSub === 1 ? ' has' : 's have'} no sub-category in IN4. `
      + 'They are on their own row so their value still reaches the total.',
    )
  }
  if (draftLines > 0) {
    notes.push(
      `${draftLines} draft purchase-order line${draftLines === 1 ? '' : 's'} (${formatINR(draftAmount)}) `
      + 'are excluded — a draft is not a committed order.',
    )
  }
  if (discounted > 0 || amended > 0) {
    const parts: string[] = []
    if (discounted > 0) parts.push(`${discounted} carr${discounted === 1 ? 'ies' : 'y'} a discount in IN4`)
    if (amended > 0) parts.push(`${amended} ${amended === 1 ? 'was' : 'were'} amended in IN4`)
    notes.push(
      `On ${discounted + amended} work order${discounted + amended === 1 ? '' : 's'} the line items do not add up to the before-tax value: `
      + parts.join(' and ') + '. The row says which. Both figures are exactly as IN4 holds them.',
    )
  }

  return { cats: out, totals, notes, in4: src.in4 }
}

/** The bill number as a person wrote it on the bill. IN4 stores it as free
 *  text and 211 rows carry a "TAX INVOICE NO :" prefix, 1,438 a "/Dt-13-05-2026"
 *  date suffix — "TAX INVOICE NO : PRO/015/26-27/Dt-13-05-2026" is the bill
 *  PRO/015/26-27. Plain forms ("SR/26-27/32", "H-2331", "01/2024-25") pass
 *  through untouched. Empty → null. */
export function cleanBillNo(raw: string | null | undefined): string | null {
  if (raw == null) return null
  let s = raw.trim()
  s = s.replace(/^\s*(tax\s+)?(invoice|bill)\s*(no\.?|number)?\s*[:\-–]?\s*/i, '')
  s = s.replace(/\s*[\/,]?\s*Dt\.?\s*[-:]?\s*\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}\s*$/i, '')
  s = s.replace(/[\/\s,;:-]+$/, '').trim()
  return s || null
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
