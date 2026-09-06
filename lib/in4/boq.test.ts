import { describe, it, expect } from 'vitest'
import { rollupWoBoqExecution } from './boq'
import type { In4WoBoqItem, In4WoAbstractItem } from './extract'

// Fixture: WO 623 (WO/SRASSK/NGH/2024-25/270, Desai Construction), the big item
// ITEM_ID 6340 — ordered 60,707.15 @ ₹1,016 — with the twelve real certificates
// (abstracts) IN4 held on this trace. The expected certified quantity and
// percent are exactly what ENGG_VIEW_WO_ABSTRACT_BOQ_COMPLETION reports for this
// item: 57,775.0565 of 60,707.15 = 95.1701%.
const ITEM = 6340
const ordered: In4WoBoqItem[] = [{
  item_id: ITEM, wo_id: 623, boq_id: 7216, category_id: 1, subcategory_id: 243,
  quantity: 60707.15, rate: 1016, amt: 61678464.4,
  boq_name: 'Civil', boq_subname: 'Civil Contractor Cost', description: null, uom: 'Cum', uom_id: 5,
}]

// (abstractId, bill, date, executed qty) — from BI.FACT_ENGG_WO_ABSTRACT_BOQ +
// ENGG_BOQ_ABSTRACT header, all ITEM_ID 6340.
const bills: Array<[number, string, string, number]> = [
  [1017, 'SRASSK-GHB/01', '2025-03-31', 12141.43],
  [1018, 'SRASSK-GHB/02', '2025-04-01', 6070.715],
  [1116, 'SRASSK-GHB/03', '2025-05-23', 6070.715],
  [1345, 'SRASSK-GHB/04', '2025-08-19', 3035.3575],
  [1517, 'SRASSK-GHB/05', '2025-09-12', 3035.358],
  [1662, 'SRASSK-GHB/06', '2025-10-16', 3035.358],
  [1663, 'SRASSK-GHB/07', '2025-10-17', 6070.715],
  [1752, 'SRASSK-GHB/08', '2025-11-19', 3035.357],
  [1911, 'SRASSK-GHB/09', '2025-12-24', 3035.357],
  [2107, 'SRASSK-GHB/10', '2026-02-04', 3035.358],
  [2338, 'SRASSK-GHB/11', '2026-04-06', 4249.501],
  [2499, 'SRASSK-GHB/12', '2026-05-28', 4959.835],
]
// Deliberately shuffled input order — the rollup must sort by date itself.
const abstracts: In4WoAbstractItem[] = [...bills]
  .reverse()
  .map(([id, bill, dt, qty]) => ({
    abstract_id: id, wo_id: 623, item_id: ITEM,
    executed_quantity: qty, recommended_rate: 1016, executed_amt: qty * 1016,
    bill_no: bill, display_no: null, abstract_dt: dt,
  }))

// A second WO's item that must NOT bleed in (different ITEM_ID).
const noise: In4WoAbstractItem[] = [{
  abstract_id: 9999, wo_id: 900, item_id: 99999,
  executed_quantity: 5000, recommended_rate: 1, executed_amt: 5000, bill_no: 'X/1', display_no: null, abstract_dt: '2025-01-01',
}]

describe('rollupWoBoqExecution — WO 623, item 6340', () => {
  const [row] = rollupWoBoqExecution(ordered, [...abstracts, ...noise])

  it('joins on ITEM_ID and finds all twelve certificates', () => {
    expect(row.billCount).toBe(12)
    expect(row.bills).toHaveLength(12)
  })

  it('certifies 57,775.06 of 60,707.15 ordered = 95.17% (matches ENGG_VIEW_WO_ABSTRACT_BOQ_COMPLETION)', () => {
    expect(row.orderedQty).toBe(60707.15)
    expect(row.certifiedQty).toBeCloseTo(57775.0565, 3)
    expect(row.pctComplete!).toBeCloseTo(95.1701, 3)
  })

  it('carries name/unit and per-bill quantities, oldest bill first', () => {
    expect(row.uom).toBe('Cum')
    expect(row.name).toBe('Civil Contractor Cost')
    expect(row.bills[0].billNo).toBe('SRASSK-GHB/01')
    expect(row.bills[0].certifiedQty).toBeCloseTo(12141.43, 2)
    expect(row.bills[11].billNo).toBe('SRASSK-GHB/12')
    // per-bill amounts reconcile with the total certified amount
    const amt = row.bills.reduce((s, b) => s + b.certifiedQty, 0)
    expect(amt).toBeCloseTo(row.certifiedQty, 6)
  })

  it('never lets another item\'s abstracts bleed in', () => {
    expect(row.bills.every(b => b.abstractId !== 9999)).toBe(true)
  })
})
