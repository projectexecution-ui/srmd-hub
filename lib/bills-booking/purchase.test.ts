import { describe, it, expect } from 'vitest'
import { buildGrnSheet, advancePosition, poScope, type PayLine, type GrnItem, type PoLine } from './purchase'

/** Certificate 784 on PO/SRET/RU/2025-26/… as the live mirror holds it: one
 *  GRN, a handful of CPVC lines, the pay line's landed cost equal to the GRN
 *  line's material cost to the paise. */
const order: PoLine[] = [
  { materialId: 11, material: 'CPVC PIPE 20MM', uom: 'Mtr', orderedQty: 300, rate: 56.27, orderedAmt: 16881, receivedQty: 220 },
  { materialId: 12, material: 'CPVC SOLVENT', uom: 'Ltr', orderedQty: 15, rate: 2102.76, orderedAmt: 31541, receivedQty: 15 },
  { materialId: 13, material: '20MM CPVC TEE', uom: 'Pcs', orderedQty: 10, rate: 16.05, orderedAmt: 160, receivedQty: 10 },
]
const receipts: GrnItem[] = [
  { grnId: 861, materialId: 11, qty: 220, cost: 12379.91, no: 'GRN/SRET/RU/2025-26/1', on: '2025-11-27', challanNo: '2951' },
  { grnId: 861, materialId: 12, qty: 15, cost: 31541.40, no: 'GRN/SRET/RU/2025-26/1', on: '2025-11-27', challanNo: '2951' },
  { grnId: 861, materialId: 13, qty: 10, cost: 160.48, no: 'GRN/SRET/RU/2025-26/1', on: '2025-11-27', challanNo: '2951' },
]
const lines: PayLine[] = [
  { grnId: 861, materialId: 11, landed: 12379.91, certified: 10491.45 },
  { grnId: 861, materialId: 12, landed: 31541.40, certified: 26730.01 },
  { grnId: 861, materialId: 13, landed: 160.48, certified: 136.00 },
]
const LANDED = 44081.79

describe('the GRN behind a supplier bill', () => {
  it('names the goods, the quantity received and what each came to', () => {
    const s = buildGrnSheet(lines, receipts, order, LANDED)!
    const solvent = s.rows.find(r => r.materialId === 12)!
    expect(solvent.material).toBe('CPVC SOLVENT')
    expect(solvent.uom).toBe('Ltr')
    expect(solvent.thisQty).toBe(15)
    expect(solvent.thisAmt).toBe(31541.40)
  })

  it('carries the goods receipt it was raised against', () => {
    const s = buildGrnSheet(lines, receipts, order, LANDED)!
    expect(s.grns).toEqual([{ no: 'GRN/SRET/RU/2025-26/1', on: '2025-11-27', challan: '2951' }])
  })

  // The lines of a bill sum to its landed cost on all 1,376 certificates —
  // better than the work-order abstract manages.
  it('reconciles the lines against what IN4 says the bill is', () => {
    const s = buildGrnSheet(lines, receipts, order, LANDED)!
    expect(s.thisBill).toBe(44081.79)
    expect(s.reconciles).toBe(true)
    expect(s.outBy).toBe(0)
  })

  it('says so rather than quietly showing a total that is wrong', () => {
    const s = buildGrnSheet(lines, receipts, order, 50_000)!
    expect(s.reconciles).toBe(false)
    expect(s.outBy).toBe(-5918.21)
  })

  it('shows what is ordered, received to date and still to come', () => {
    const s = buildGrnSheet(lines, receipts, order, LANDED)!
    const pipe = s.rows.find(r => r.materialId === 11)!
    expect(pipe.orderedQty).toBe(300)
    expect(pipe.receivedQty).toBe(220)   // IN4's own running figure on the PO line
    expect(pipe.balanceQty).toBe(80)
    expect(pipe.complete).toBe(false)
    const tee = s.rows.find(r => r.materialId === 13)!
    expect(tee.balanceQty).toBe(0)
    expect(tee.complete).toBe(true)
  })

  it('flags a line received past what was ordered', () => {
    const over = [{ ...order[0], receivedQty: 340 }]
    const s = buildGrnSheet([lines[0]], receipts, over, 12379.91)!
    expect(s.rows[0].overrun).toBe(true)
    expect(s.rows[0].balanceQty).toBe(-40)
    expect(s.anyOverrun).toBe(true)
  })

  it('puts the biggest line first, which is how a bill gets checked', () => {
    const s = buildGrnSheet(lines, receipts, order, LANDED)!
    expect(s.rows.map(r => r.materialId)).toEqual([12, 11, 13])
  })

  // Some pay lines name a GRN with no matching receipt line. The money is
  // known; the quantity is not, and saying "0" would read as "nothing came".
  it('leaves the quantity unknown rather than calling it zero', () => {
    const s = buildGrnSheet(lines, [], order, LANDED)!
    expect(s.rows.every(r => r.thisQty === null)).toBe(true)
    expect(s.rows.every(r => r.receiptQty === null)).toBe(true)
    expect(s.thisBill).toBe(44081.79)
  })

  /* The trap the live data sprung. On the newest bill of PO/SRASSK/NGH/2026-27/9
     IN4 bills ₹94,400 against a receipt that records 160 RMT costing ₹1,88,800
     — the bill covers half of that receipt. Deriving the quantity by the ratio
     of the two would have been arithmetic on an approval record: elsewhere in
     the same table that division gives a share of 95×. */
  it('does not invent a quantity when the bill covers part of a receipt', () => {
    const s = buildGrnSheet(
      [{ grnId: 1494, materialId: 3614, landed: 94_400, certified: 80_000 }],
      [{ grnId: 1494, materialId: 3614, qty: 160, cost: 188_800, no: 'GRN/SRASSK/NGH/2026-27/1', on: '2026-06-30', challanNo: null }],
      [{ materialId: 3614, material: 'PU SHAPE DRAIN T-6 LID 450 X 450', uom: 'RMT', orderedQty: 764, rate: 1000, orderedAmt: 764_000, receivedQty: 764 }],
      94_400)!
    expect(s.rows[0].thisQty).toBeNull()      // never 80, and never 160
    expect(s.rows[0].receiptQty).toBe(160)    // what the receipt itself records
    expect(s.rows[0].thisAmt).toBe(94_400)
    expect(s.reconciles).toBe(true)
  })

  it('will not carry a certain quantity through an uncertain sibling line', () => {
    const s = buildGrnSheet([
      { grnId: 861, materialId: 11, landed: 12379.91, certified: 10491.45 },  // agrees
      { grnId: 870, materialId: 11, landed: 500, certified: 425 },            // half a receipt
    ], [
      ...receipts,
      { grnId: 870, materialId: 11, qty: 18, cost: 1000, no: 'GRN/SRET/RU/2025-26/2', on: '2025-12-04', challanNo: null },
    ], order, 12879.91)!
    expect(s.rows[0].thisQty).toBeNull()
    expect(s.rows[0].receiptQty).toBe(238)
    expect(s.rows[0].thisAmt).toBe(12879.91)
  })

  // IN4 reuses one GRN number across many receipts on the same order.
  it('folds receipts that share a number and a date into one', () => {
    const s = buildGrnSheet(
      [{ grnId: 1494, materialId: 11, landed: 100, certified: 85 },
       { grnId: 1495, materialId: 12, landed: 100, certified: 85 }],
      [{ grnId: 1494, materialId: 11, qty: 1, cost: 100, no: 'GRN/SRASSK/NGH/2026-27/1', on: '2026-06-30', challanNo: null },
       { grnId: 1495, materialId: 12, qty: 1, cost: 100, no: 'GRN/SRASSK/NGH/2026-27/1', on: '2026-06-30', challanNo: null }],
      order, 200)!
    expect(s.grns).toHaveLength(1)
  })

  // Freight and handling arrive on the bill without being on the order.
  it('still prices a line that is not on the purchase order, and marks it', () => {
    const s = buildGrnSheet(
      [...lines, { grnId: 861, materialId: 99, landed: 2000, certified: 2000 }],
      receipts, order, LANDED + 2000)!
    const extra = s.rows.find(r => r.materialId === 99)!
    expect(extra.offOrder).toBe(true)
    expect(extra.orderedQty).toBe(0)
    expect(extra.overrun).toBe(false)
    expect(s.reconciles).toBe(true)
  })

  it('folds a material that arrived on two receipts into one row', () => {
    const s = buildGrnSheet([
      { grnId: 861, materialId: 11, landed: 12379.91, certified: 10491.45 },
      { grnId: 870, materialId: 11, landed: 1000, certified: 850 },
    ], [
      ...receipts,
      { grnId: 870, materialId: 11, qty: 18, cost: 1000, no: 'GRN/SRET/RU/2025-26/2', on: '2025-12-04', challanNo: '3017' },
    ], order, 13379.91)!
    expect(s.rows).toHaveLength(1)
    expect(s.rows[0].thisQty).toBe(238)
    expect(s.rows[0].thisAmt).toBe(13379.91)
    // Both receipts named, oldest first.
    expect(s.grns.map(g => g.no)).toEqual(['GRN/SRET/RU/2025-26/1', 'GRN/SRET/RU/2025-26/2'])
  })

  it('is nothing at all when the bill has no lines', () => {
    expect(buildGrnSheet([], receipts, order, 0)).toBeNull()
  })
})

describe('the advance on a purchase order', () => {
  // Aksha, 15 Sep 2026: "Advance are done as per terms." 215 orders took one,
  // 9.9 Cr, and 8.48 Cr has been recovered out of the bills that followed.
  it('shows what was taken, what came back and what is left', () => {
    const a = advancePosition([{ gross: 500_000, paid: 500_000 }], 320_000, 80_000)!
    expect(a.taken).toBe(500_000)
    expect(a.paid).toBe(500_000)
    expect(a.recovered).toBe(320_000)
    expect(a.outstanding).toBe(180_000)
    expect(a.thisBill).toBe(80_000)
    expect(a.settled).toBe(false)
  })

  it('says an order is square once the advance is fully recovered', () => {
    const a = advancePosition([{ gross: 500_000, paid: 500_000 }], 500_000, 50_000)!
    expect(a.outstanding).toBe(0)
    expect(a.settled).toBe(true)
  })

  it('adds up more than one advance', () => {
    const a = advancePosition([
      { gross: 300_000, paid: 300_000 },
      { gross: 200_000, paid: 0 },
    ], 0, 0)!
    expect(a.count).toBe(2)
    expect(a.taken).toBe(500_000)
    expect(a.paid).toBe(300_000)
  })

  // Recovered past the advance is an adjustment, not a negative balance owed.
  it('never reports a negative amount still to recover', () => {
    expect(advancePosition([{ gross: 100_000, paid: 100_000 }], 130_000, 0)!.outstanding).toBe(0)
  })

  it('is nothing at all on an order that took no advance', () => {
    expect(advancePosition([], 0, 0)).toBeNull()
  })
})

describe('what a purchase order is for, in words', () => {
  const lines = [
    { material: 'PU SHAPE DRAIN T-6 450 X 450', orderedAmt: 2_147_950 },
    { material: 'PU SHAPE DRAIN T-6 LID 450 X 450 B- SOLID', orderedAmt: 764_000 },
    { material: 'PU SHAPE DRAIN T-6 750 X 750', orderedAmt: 49_500 },
    { material: 'PU SHAPE DRAIN T-6 LID 750 X 750 B- SOLID', orderedAmt: 19_750 },
  ]

  it('leads with the material the order mostly is', () => {
    expect(poScope(lines)!.startsWith('PU SHAPE DRAIN T-6 450 X 450')).toBe(true)
  })

  it('counts the rest rather than running on', () => {
    const s = poScope(lines)!
    expect(s).toMatch(/and \d+ more$/)
    expect(s.length).toBeLessThan(110)
  })

  it('names them all when they fit', () => {
    expect(poScope([{ material: 'CEMENT OPC 53', orderedAmt: 10 }])).toBe('CEMENT OPC 53')
    expect(poScope([
      { material: 'CEMENT', orderedAmt: 10 },
      { material: 'SAND', orderedAmt: 5 },
    ])).toBe('CEMENT, SAND')
  })

  // A name longer than the whole budget must still produce something.
  it('always names at least one, however long it is', () => {
    const long = 'A'.repeat(200)
    expect(poScope([{ material: long, orderedAmt: 1 }, { material: 'B', orderedAmt: 0 }]))
      .toBe(`${long} and 1 more`)
  })

  it('is nothing when IN4 names no material', () => {
    expect(poScope([])).toBeNull()
    expect(poScope([{ material: '   ', orderedAmt: 5 }])).toBeNull()
  })
})
