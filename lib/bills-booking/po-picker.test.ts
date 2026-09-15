import { describe, it, expect } from 'vitest'
import { buildPoList } from './po-picker'

/** Shapes taken from the live mirror on 15 Sep 2026, so the tests fail if IN4's
 *  conventions turn out to be something other than what was checked. */
const suppliers = new Map([[9, 'Pankaj Metal Corporation'], [76, 'Shree Darshan Granite House']])

const po = (o: Partial<Parameters<typeof buildPoList>[0][number]> = {}) => ({
  po_id: 1257, po_no: 'PO/SRASSK/NGH/2026-27/9', supplier_id: 9, project_id: 12,
  po_value: 3_517_816, status: 'Approved', ...o,
})
const item = (o: Partial<Parameters<typeof buildPoList>[1][number]> = {}) => ({
  po_id: 1257, subproject_id: 71, material_value: 2_981_200, ...o,
})
const cert = (o: Partial<Parameters<typeof buildPoList>[2][number]> = {}) => ({
  po_id: 1257, kind: 'payment', certificate_no: '916', certificate_date: '2026-01-01',
  category: '07 (M) Electrical Works',
  certified_amt: 1_000_000, landed_cost: 1_180_000, retention: 0, ...o,
})

describe('purchase-order picker', () => {
  it('fills supplier, ordered value, billed and balance from IN4', () => {
    const [p] = buildPoList([po()], [item()], [cert()], suppliers)
    expect(p.kind).toBe('PO')
    expect(p.party).toBe('Pankaj Metal Corporation')
    expect(p.orderedGross).toBe(3_517_816)
    expect(p.billedGross).toBe(1_180_000)
    expect(p.balance).toBe(2_337_816)
  })

  it('reads the trust out of the PO number, the same way a WO number is read', () => {
    expect(buildPoList([po()], [], [], suppliers)[0].trust).toBe('SRASSK')
    expect(buildPoList([po({ po_no: 'PO/SRET/RU/2025-26/299' })], [], [], suppliers)[0].trust).toBe('SRET')
  })

  // A purchase order carries no sub-project of its own — only its lines do.
  it('books to the sub-project its lines put the most money into', () => {
    const [p] = buildPoList([po()], [
      item({ subproject_id: 71, material_value: 100_000 }),
      item({ subproject_id: 7, material_value: 900_000 }),
    ], [], suppliers)
    expect(p.subprojectId).toBe(7)
    expect(p.subprojectCount).toBe(2)
  })

  it('says how many sub-projects it spans rather than booking one quietly', () => {
    expect(buildPoList([po()], [item()], [], suppliers)[0].subprojectCount).toBe(1)
    const [spread] = buildPoList([po()], [
      item({ subproject_id: 71, material_value: 10 }),
      item({ subproject_id: 7, material_value: 20 }),
      item({ subproject_id: 5, material_value: 30 }),
    ], [], suppliers)
    expect(spread.subprojectCount).toBe(3)
  })

  it('leaves the sub-project empty rather than guessing when no line names one', () => {
    const [p] = buildPoList([po()], [item({ subproject_id: null })], [], suppliers)
    expect(p.subprojectId).toBeNull()
    expect(p.subprojectCount).toBe(0)
  })

  // 244 advance certificates carry ₹9.9 Cr. An advance is paid ahead and
  // recovered out of later bills, so counting it as billed shows the order
  // spent twice.
  it('does not count an advance as a bill', () => {
    const [p] = buildPoList([po()], [item()], [
      cert({ landed_cost: 1_180_000 }),
      cert({ kind: 'advance', landed_cost: 2_000_000, certificate_date: '2026-02-01' }),
    ], suppliers)
    expect(p.billedGross).toBe(1_180_000)
    expect(p.bills).toBe(1)
  })

  it('counts the bills so far and carries the last bill number, latest by date', () => {
    const [p] = buildPoList([po()], [item()], [
      cert({ certificate_no: '101', certificate_date: '2026-03-01' }),
      cert({ certificate_no: '318', certificate_date: '2026-07-01' }),
      cert({ certificate_no: '204', certificate_date: '2026-05-01' }),
    ], suppliers)
    expect(p.bills).toBe(3)
    expect(p.lastBillNo).toBe('318')
  })

  // IN4 writes the skill on the supplier's bill, not on the order, and marks
  // the ledger it came out of: "07 (M) Electrical Works".
  it('takes the category off the latest bill, and only the first when several', () => {
    const [p] = buildPoList([po()], [item()], [
      cert({ category: '19 (M) Site Admin', certificate_date: '2026-01-01' }),
      cert({ category: '03 (M) Civil,12 (M) Finishes', certificate_date: '2026-06-01' }),
    ], suppliers)
    expect(p.categoryName).toBe('03 (M) Civil')
    expect(p.categoryId).toBeNull()
  })

  it('carries no category at all on an order nothing has been billed against', () => {
    expect(buildPoList([po()], [item()], [], suppliers)[0].categoryName).toBeNull()
  })

  it('derives the retention rate from what IN4 actually deducted', () => {
    // Supplier bills almost never hold retention — 21 of 1,376 — and saying 0%
    // is the truth, not a missing figure.
    expect(buildPoList([po()], [item()], [cert()], suppliers)[0].retentionPct).toBe(0)
    expect(buildPoList([po()], [item()], [cert({ retention: 50_000 })], suppliers)[0].retentionPct).toBe(5)
    expect(buildPoList([po()], [item()], [], suppliers)[0].retentionPct).toBeNull()
  })

  // IN4 only issues a real number once the order is approved. You cannot
  // receive a supplier bill quoting a number that does not exist yet.
  it('drops orders IN4 has not numbered, and ones that are over', () => {
    const list = buildPoList([
      po({ po_id: 1, po_no: 'PO/SRASSK/NGH/2026-27/1' }),
      po({ po_id: 2, po_no: 'DRAFT-PO/SRASSK/NGH/2026-27/1450', status: 'Draft' }),
      po({ po_id: 3, po_no: 'DRAFT-PO/SRASSK/AB/2026-27/1447', status: 'Submitted' }),
      po({ po_id: 4, po_no: 'PO/SRET/RU/2024-25/8', status: 'Terminated' }),
      po({ po_id: 5, po_no: 'PO/SRET/RU/2024-25/9', status: 'Cancelled' }),
      po({ po_id: 6, po_no: null }),
    ], [], [], suppliers)
    expect(list.map(p => p.orderId)).toEqual([1])
  })

  it('never reports a negative balance on an over-billed order', () => {
    const [p] = buildPoList([po({ po_value: 1000 })], [item()], [cert({ landed_cost: 1500 })], suppliers)
    expect(p.balance).toBe(0)
  })

  it('puts the newest order first', () => {
    const list = buildPoList([
      po({ po_id: 300, po_no: 'PO/SRASSK/NGH/2025-26/1' }),
      po({ po_id: 900, po_no: 'PO/SRASSK/NGH/2026-27/1' }),
    ], [], [], suppliers)
    expect(list.map(p => p.orderId)).toEqual([900, 300])
  })

  it('leaves the supplier blank rather than guessing when the party is unknown', () => {
    expect(buildPoList([po({ supplier_id: 999 })], [], [], suppliers)[0].party).toBe('')
  })

  // A purchase order has no description field. Asked for on the form instead.
  it('carries no scope, because IN4 holds none for a purchase order', () => {
    expect(buildPoList([po()], [item()], [cert()], suppliers)[0].workDescription).toBeNull()
  })
})
