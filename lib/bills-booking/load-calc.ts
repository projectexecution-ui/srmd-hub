import type { SupabaseClient } from '@supabase/supabase-js'
import { billLadder, woHistory, type CertMoney, type BillLadder, type WoHistory } from './calc'
import { buildAbstractSheet, type AbstractSheet, type AbstractLine, type BoqLine } from './abstract'
import { seedLines, type MakerLine } from './maker'

/** The live IN4 position behind one CT Hub bill.
 *
 *  A bill in CT Hub carries a claimed figure and not much else. The work order
 *  it names has a real history in IN4 — every bill raised on it, what each was
 *  certified at, what tax went on, what was held back and what has been paid.
 *  That is the arithmetic an approver needs, and CT Hub already mirrors it. */

export interface BillCalc {
  /** The order this bill is drawn against, as IN4 has it. */
  woNo: string
  orderedGross: number
  /** Every bill on that order, this one's predecessors included. */
  history: WoHistory
  /** The ladder for THIS bill, when a certificate for it exists in IN4. Null
   *  while the bill is still moving through CT Hub and Billing has not keyed
   *  it — which is most of the time, and is not an error. */
  mine: BillLadder | null
  /** The certificate the ladder came from. */
  mineCert: CertMoney | null
  /** What this bill would look like if it were certified at the claimed figure,
   *  using the tax and retention this work order has actually carried. Shown
   *  only when there is no real certificate yet, and always labelled as an
   *  expectation rather than a fact. */
  expected: BillLadder | null
  /** The measurement behind this bill, line by line, when IN4 holds one. */
  sheet: AbstractSheet | null
}

const n = (v: unknown) => Number(v ?? 0)

const toMoney = (r: Record<string, unknown>): CertMoney => ({
  certificateId: n(r.certificate_id),
  displayNo: (r.display_no as string | null) ?? null,
  invoiceNo: (r.invoice_no as string | null) ?? null,
  createdOn: (r.creation_dt as string | null) ?? null,
  statusName: (r.status_name as string | null) ?? null,
  certified: n(r.certified_amt),
  gross: n(r.gross_bill_amt),
  retention: n(r.retention_amt),
  advanceRecovery: n(r.advance_recovery_amt),
  recoveries: n(r.recoveries),
  deductions: n(r.deductions),
  paid: n(r.paid_amt),
  outstanding: n(r.outstanding_amt),
})

/** The rates this work order has actually carried, averaged over its live
 *  bills. Never a house rule: retention is 10% on some orders and 5% on
 *  others, and 60% of IN4 bills carry no tax at all. With no history there is
 *  nothing to go on, and the expectation is not shown. */
function ratesFrom(certs: CertMoney[]): { gst: number; retention: number } | null {
  const live = certs.filter(c => c.certified > 0)
  if (!live.length) return null
  const basic = live.reduce((s, c) => s + c.certified, 0)
  if (!(basic > 0)) return null
  return {
    gst: live.reduce((s, c) => s + (c.gross - c.certified), 0) / basic,
    retention: live.reduce((s, c) => s + c.retention, 0) / basic,
  }
}

export async function loadBillCalc(
  sb: SupabaseClient,
  bill: { orderNo: string | null; billNo: string | null; raNo: string | null; claimed: number; abstractNo: string | null },
): Promise<BillCalc | null> {
  const woNo = bill.orderNo?.trim()
  if (!woNo) return null

  const { data: woRow } = await sb.from('in4_work_orders')
    .select('wo_id, wo_gross_value').eq('display_no', woNo).maybeSingle()
  if (!woRow) return null

  const { data: certData } = await sb.from('in4_wo_certificates')
    .select('certificate_id, display_no, invoice_no, creation_dt, status_name, certified_amt, gross_bill_amt, retention_amt, advance_recovery_amt, recoveries, deductions, paid_amt, outstanding_amt')
    .eq('wo_id', woRow.wo_id as number)

  const certs = ((certData ?? []) as Record<string, unknown>[]).map(toMoney)
  const ordered = n(woRow.wo_gross_value)
  const history = woHistory(certs, ordered)

  // Is one of them THIS bill? Billing keys the contractor's invoice number
  // into IN4, so that is the only honest link — matching on amount would pair
  // two bills of the same value on the same order, which happens.
  const key = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
  const mineCert = certs.find(c =>
    (bill.abstractNo && key(c.displayNo) === key(bill.abstractNo)) ||
    (bill.billNo && key(c.invoiceNo) === key(bill.billNo))) ?? null

  let expected: BillLadder | null = null
  if (!mineCert && bill.claimed > 0) {
    const rates = ratesFrom(certs.filter(c => !['cancelled', 'reversed'].includes(key(c.statusName))))
    if (rates) {
      // The claim is a gross figure — that is how Aksha works — so the basic
      // value is backed out of it rather than the tax being added on top.
      const basic = Math.round(bill.claimed / (1 + rates.gst))
      const gross = Math.round(basic * (1 + rates.gst))
      const retention = Math.round(basic * rates.retention)
      expected = billLadder({
        certificateId: 0, displayNo: null, invoiceNo: null, createdOn: null, statusName: null,
        certified: basic, gross, retention,
        advanceRecovery: 0, recoveries: 0, deductions: 0, paid: 0,
        outstanding: gross - retention,
      })
    }
  }

  // The abstract sheet for this bill, matched on the contractor's invoice
  // number. Only meaningful once a certificate exists.
  const sheet = mineCert
    ? await loadAbstractSheet(sb, { woNo, invoiceNo: mineCert.invoiceNo, certified: mineCert.certified }).catch(() => null)
    : null

  return {
    woNo,
    orderedGross: ordered,
    history,
    mine: mineCert ? billLadder(mineCert) : null,
    mineCert,
    expected,
    sheet,
  }
}

/* ── the abstract sheet ──────────────────────────────────────────────────── */



/** The measurement behind one bill, from IN4.
 *
 *  Matched on the contractor's invoice number — the abstract's `bill_no`
 *  against the certificate's `invoice_no`. NOT on `abstract_id`, which is the
 *  abstract's own id in its own id space and matches nothing; see the note at
 *  the top of abstract.ts for how long that cost me.
 *
 *  Null when IN4 holds no abstract for this bill, which is normal: 2,085 of
 *  them reach a certificate, and a bill still moving through CT Hub has none
 *  yet at all. */
export async function loadAbstractSheet(
  sb: SupabaseClient,
  opts: { woNo: string; invoiceNo: string | null; certified: number },
): Promise<AbstractSheet | null> {
  const key = opts.invoiceNo?.trim()
  if (!key) return null

  const { data: wo } = await sb.from('in4_work_orders')
    .select('wo_id').eq('display_no', opts.woNo).maybeSingle()
  if (!wo) return null
  const woId = wo.wo_id as number

  const { data: allLines } = await sb.from('in4_wo_abstract_items')
    .select('abstract_id, item_id, display_no, bill_no, abstract_dt, executed_quantity, recommended_rate, executed_amt')
    .eq('wo_id', woId)
  if (!allLines?.length) return null

  const rows: AbstractLine[] = allLines.map(l => ({
    abstractId: Number(l.abstract_id),
    itemId: Number(l.item_id),
    abstractNo: (l.display_no as string | null) ?? null,
    billNo: (l.bill_no as string | null) ?? null,
    on: (l.abstract_dt as string | null) ?? null,
    qty: Number(l.executed_quantity ?? 0),
    rate: Number(l.recommended_rate ?? 0),
    amt: Number(l.executed_amt ?? 0),
  }))

  const same = (a: string | null, b: string) => (a ?? '').trim().toLowerCase() === b.toLowerCase()
  const mine = rows.filter(r => same(r.billNo, key))
  if (!mine.length) return null

  // Everything measured on this order BEFORE this abstract — that is what makes
  // the cumulative column honest. Ordered by date, then by id for the two that
  // share a day.
  const mineId = mine[0].abstractId
  const mineOn = mine[0].on ?? ''
  const earlier = rows.filter(r =>
    r.abstractId !== mineId &&
    ((r.on ?? '') < mineOn || ((r.on ?? '') === mineOn && r.abstractId < mineId)))

  const { data: boqData } = await sb.from('in4_wo_boq_items')
    .select('item_id, boq_name, description, uom, quantity, rate, amt').eq('wo_id', woId)
  const boq: BoqLine[] = (boqData ?? []).map(b => ({
    itemId: Number(b.item_id),
    name: (b.boq_name as string | null) ?? null,
    description: (b.description as string | null) ?? null,
    uom: (b.uom as string | null) ?? null,
    orderedQty: Number(b.quantity ?? 0),
    rate: Number(b.rate ?? 0),
    orderedAmt: Number(b.amt ?? 0),
  }))

  return buildAbstractSheet(mine, earlier, boq, opts.certified)
}

/* ── the maker ───────────────────────────────────────────────────────────── */

/** Seed the Abstract maker for one bill.
 *
 *  Lines come from the work order's own BOQ, which is mirrored exact. What has
 *  already been measured — by IN4's earlier abstracts and by earlier CT Hub
 *  sheets on the same order — is folded in as `prior`, so the first thing a
 *  Site Head sees is the balance still to do rather than a blank page.
 *
 *  Any quantities already saved on THIS bill come back in, so the sheet
 *  reopens where it was left. */
export async function loadMakerSeed(
  sb: SupabaseClient,
  opts: { billId: string; woNo: string },
): Promise<{ lines: MakerLine[]; gstPct: number; retentionPct: number } | null> {
  const { data: wo } = await sb.from('in4_work_orders')
    .select('wo_id').eq('display_no', opts.woNo).maybeSingle()
  if (!wo) return null
  const woId = wo.wo_id as number

  const [{ data: boqData }, { data: in4Lines }, { data: mine }, { data: certData }] = await Promise.all([
    sb.from('in4_wo_boq_items').select('item_id, boq_name, description, uom, quantity, rate, amt').eq('wo_id', woId),
    sb.from('in4_wo_abstract_items').select('item_id, executed_quantity, executed_amt').eq('wo_id', woId),
    sb.from('bb_bill_lines').select('sr, item_id, this_qty').eq('bill_id', opts.billId),
    sb.from('in4_wo_certificates')
      .select('certified_amt, gross_bill_amt, retention_amt, status_name').eq('wo_id', woId),
  ])
  if (!boqData?.length) return null

  // What IN4 already shows measured, per item.
  const measured = new Map<number, { qty: number; amt: number }>()
  for (const l of in4Lines ?? []) {
    const id = Number(l.item_id)
    const cur = measured.get(id) ?? { qty: 0, amt: 0 }
    cur.qty += Number(l.executed_quantity ?? 0)
    cur.amt += Number(l.executed_amt ?? 0)
    measured.set(id, cur)
  }

  const lines = seedLines(
    boqData.map(b => ({
      itemId: Number(b.item_id),
      name: (b.boq_name as string | null) ?? null,
      description: (b.description as string | null) ?? null,
      uom: (b.uom as string | null) ?? null,
      orderedQty: Number(b.quantity ?? 0),
      rate: Number(b.rate ?? 0),
      orderedAmt: Number(b.amt ?? 0),
    })),
    measured,
  )

  // Put back whatever was already typed on this bill.
  const saved = new Map((mine ?? []).map(r => [Number(r.item_id), Number(r.this_qty ?? 0)]))
  for (const l of lines) if (l.itemId != null && saved.has(l.itemId)) l.thisQty = saved.get(l.itemId)!

  // The rates this order has actually carried, so the sheet opens on the right
  // ones instead of a house rule nobody agreed. 60% of IN4 bills have no tax.
  const live = (certData ?? []).filter(c =>
    !['cancelled', 'reversed'].includes(((c.status_name as string | null) ?? '').trim().toLowerCase())
    && Number(c.certified_amt ?? 0) > 0)
  const basic = live.reduce((s, c) => s + Number(c.certified_amt ?? 0), 0)
  const gstPct = basic > 0
    ? Math.round((live.reduce((s, c) => s + (Number(c.gross_bill_amt ?? 0) - Number(c.certified_amt ?? 0)), 0) / basic) * 1000) / 10
    : 18
  const retentionPct = basic > 0
    ? Math.round((live.reduce((s, c) => s + Number(c.retention_amt ?? 0), 0) / basic) * 1000) / 10
    : 5

  return { lines, gstPct, retentionPct }
}
