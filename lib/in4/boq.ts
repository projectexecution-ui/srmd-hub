// Ordered-vs-certified rollup for a work order's BOQ, from the two IN4 facts:
//   ordered   = BI.FACT_ENGG_WORK_ORDER_BOQ   (In4WoBoqItem)
//   certified = BI.FACT_ENGG_WO_ABSTRACT_BOQ   (In4WoAbstractItem), one row per
//               (certificate, item), the bill no/date on the ENGG_BOQ_ABSTRACT header.
//
// The join is on ITEM_ID, never BOQ_ID — the two facts disagree on BOQ_ID by one
// (ordered 7216 vs abstract 7215 for the same line), so a BOQ_ID join silently
// returns nothing. Verified on WO 623 item 6340: the twelve bills sum to
// 57,775.06 of 60,707.15 ordered = 95.17%, exactly ENGG_VIEW_WO_ABSTRACT_BOQ_COMPLETION.

import type { In4WoBoqItem, In4WoAbstractItem } from './extract'

export interface BoqBill {
  abstractId: number; billNo: string | null; displayNo: string | null; date: string | null
  certifiedQty: number; certifiedAmt: number
}
export interface BoqExecutionRow {
  woId: number; itemId: number; boqId: number
  name: string | null; description: string | null; uom: string | null
  orderedQty: number; rate: number; orderedAmt: number
  certifiedQty: number; certifiedAmt: number
  pctComplete: number | null
  billCount: number; bills: BoqBill[]
}

/** One row per ordered BOQ item, with every certificate's certified quantity
 *  underneath (oldest bill first). Joins ON ITEM_ID. */
export function rollupWoBoqExecution(items: In4WoBoqItem[], abstracts: In4WoAbstractItem[]): BoqExecutionRow[] {
  const byItem = new Map<number, In4WoAbstractItem[]>()
  for (const a of abstracts) {
    const arr = byItem.get(a.item_id)
    if (arr) arr.push(a); else byItem.set(a.item_id, [a])
  }
  return items.map(it => {
    const abs = (byItem.get(it.item_id) ?? [])
      .slice()
      .sort((a, b) => (a.abstract_dt ?? '').localeCompare(b.abstract_dt ?? ''))
    const certifiedQty = abs.reduce((s, a) => s + a.executed_quantity, 0)
    const certifiedAmt = abs.reduce((s, a) => s + a.executed_amt, 0)
    return {
      woId: it.wo_id, itemId: it.item_id, boqId: it.boq_id,
      name: it.boq_subname || it.boq_name, description: it.description, uom: it.uom,
      orderedQty: it.quantity, rate: it.rate, orderedAmt: it.amt,
      certifiedQty, certifiedAmt,
      pctComplete: it.quantity > 0 ? (100 * certifiedQty) / it.quantity : null,
      billCount: abs.length,
      bills: abs.map(a => ({
        abstractId: a.abstract_id, billNo: a.bill_no, displayNo: a.display_no, date: a.abstract_dt,
        certifiedQty: a.executed_quantity, certifiedAmt: a.executed_amt,
      })),
    }
  })
}
