/** An order you can raise a bill against — a work order or a purchase order.
 *
 *  Aksha, 15 Sep 2026: "i am unable to search for PO - can u make that as well
 *  incorporated but a option should come for WO or PO then we search as per
 *  that selection."
 *
 *  Right, and it was a real hole: the entry form searched 2,181 work orders and
 *  nothing else, while IN4 carries 1,451 purchase orders, 1,271 of them
 *  approved and 1,152 already carrying supplier bills. A vendor bill had to be
 *  entered as "no work order yet", which is a lie the whole section then
 *  repeats — it ages wrongly, it never reaches an Atm desk, and it books
 *  against nothing.
 *
 *  So both sides speak this one shape. Everything the form needs is on it, and
 *  `kind` is the only thing that has to be branched on. The field names say
 *  "order" rather than "wo" deliberately: a field called `woNo` holding
 *  "PO/SRET/RU/2025-26/299" is exactly the sort of quiet dishonesty that costs
 *  an afternoon six months from now.
 *
 *  WHERE EACH SIDE'S NUMBERS COME FROM
 *
 *    ordered     WO  in4_work_orders.wo_gross_value
 *                PO  in4_purchase_orders.po_value — gross too. Checked: 731 of
 *                    1,271 approved POs sit at exactly 1.18 × the sum of their
 *                    line values, average 1.1957, and on a fulfilled PO the
 *                    supplier bills sum to po_value to the rupee.
 *    billed      WO  in4_wo_certificates.gross_bill_amt
 *                PO  in4_supplier_certificates.landed_cost, payments only.
 *                    The PO header's own payable_amt is NOT billed-to-date —
 *                    it is what is payable after advances are adjusted, and it
 *                    disagrees with the bills on a quarter of orders.
 *    category    WO  the IN4 skill id on the order
 *                PO  the skill NAME off its latest bill: "12 (M) Finishes".
 *                    A purchase order carries no skill of its own.
 */

export interface PickableOrder {
  /** Which ERP document this is. The only thing worth branching on. */
  kind: 'WO' | 'PO'
  /** IN4's id WITHIN that kind. wo_id 827 and po_id 827 both exist, so this is
   *  never a key on its own — pair it with `kind`. */
  orderId: number
  orderNo: string
  /** IN4's project, used only to say which building a match belongs to while
   *  somebody is still choosing between several. */
  projectId: number | null
  /** IN4's sub-project — the key everything about where a bill books hangs off.
   *  A work order names one outright. A purchase order does not: it is taken
   *  from the PO's own lines, the one carrying the most value. */
  subprojectId: number | null
  /** How many sub-projects the order actually spans. 1 for every work order and
   *  for 1,402 of 1,451 POs; the other 49 are split across two to four, and the
   *  screen says so rather than booking them somewhere silently. */
  subprojectCount: number
  /** The IN4 skill id, when the order carries one. Work orders do. */
  categoryId: number | null
  /** The IN4 skill NAME, when that is all there is. Purchase orders. */
  categoryName: string | null
  /** The scope in the engineer's words. Work orders carry one; purchase orders
   *  have no equivalent field, so it is asked for instead of invented. */
  workDescription: string | null
  /** The contractor on a WO, the supplier on a PO. */
  partyId: number | null
  party: string
  /** Ordered value including GST — the figure to compare a bill against. */
  orderedGross: number
  /** Everything billed so far, including GST. */
  billedGross: number
  /** orderedGross − billedGross, floored at zero. */
  balance: number
  /** Retention actually applied, as a percentage of the basic value. It is per
   *  order, not a house rule: work orders carry 5%, 10% or none, and supplier
   *  bills carry it on 21 certificates out of 1,376. */
  retentionPct: number | null
  /** SRASSK / SRET / SRJT, read off the order number. */
  trust: string | null
  /** How many bills already exist against it. */
  bills: number
  /** The number the last bill carried. */
  lastBillNo: string | null
  status: string | null
}

/** A stable key for a list — see the note on `orderId`. */
export const orderKey = (o: PickableOrder): string => `${o.kind}-${o.orderId}`
