import type { SupabaseClient } from '@supabase/supabase-js'
import { billLadder, woHistory, type CertMoney, type BillLadder, type WoHistory } from './calc'

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

  return {
    woNo,
    orderedGross: ordered,
    history,
    mine: mineCert ? billLadder(mineCert) : null,
    mineCert,
    expected,
  }
}
