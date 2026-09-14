import { describe, it, expect } from 'vitest'
import { priceAbstract, seedLines, type MakerLine } from './maker'

/** The concept sheet's own worked example, so the maker produces the numbers
 *  Aksha already approved the shape of: five lines measured on a bill against
 *  a ₹27.26 L order, GST 18%, retention 5%. */
const line = (o: Partial<MakerLine>): MakerLine => ({
  itemId: 1, sr: 1, particular: 'Excavator 200', uom: 'Per Hr',
  orderedQty: 298.5, rate: 3000, orderedAmt: 895500,
  priorQty: 298.5, priorAmt: 895500, thisQty: 0, ...o,
})

const SHEET: MakerLine[] = [
  line({}),                                                                   // done on an earlier bill
  line({ itemId: 10, sr: 2, particular: 'Supply of Poclain 210 (Bucket)', orderedQty: 7, rate: 3000, orderedAmt: 21000, priorQty: 0, priorAmt: 0, thisQty: 7 }),
  line({ itemId: 11, sr: 3, particular: 'Supply of JCB', orderedQty: 120.75, rate: 900, orderedAmt: 108675, priorQty: 0, priorAmt: 0, thisQty: 120.75 }),
  line({ itemId: 13, sr: 4, particular: 'Supply of Truck', orderedQty: 35, rate: 1300, orderedAmt: 45500, priorQty: 0, priorAmt: 0, thisQty: 35 }),
  line({ itemId: 16, sr: 5, particular: 'Supply of Male Coolie', uom: 'Nos', orderedQty: 52, rate: 750, orderedAmt: 39000, priorQty: 0, priorAmt: 0, thisQty: 52 }),
]

const RATES = { gstPct: 18, retentionPct: 5 }
const row = (s: ReturnType<typeof priceAbstract>, kind: string) => s.totals.find(t => t.kind === kind)!

describe('the abstract maker', () => {
  it('prices each line from quantity × the ordered rate', () => {
    const s = priceAbstract(SHEET, RATES)
    expect(s.lines.map(l => l.thisAmt)).toEqual([0, 21000, 108675, 45500, 39000])
    // 21,000 + 1,08,675 + 45,500 + 39,000 = 2,14,175
    expect(s.basicThisBill).toBe(214175)
  })

  it('rolls the cumulative forward and leaves the balance', () => {
    const s = priceAbstract(SHEET, RATES)
    const jcb = s.lines.find(l => l.itemId === 11)!
    expect(jcb.cumQty).toBe(120.75)
    expect(jcb.balQty).toBe(0)
    expect(jcb.complete).toBe(true)
    // The line finished on an earlier bill contributes nothing now but still
    // shows its cumulative — that is the whole point of the column.
    const exc = s.lines.find(l => l.itemId === 1)!
    expect(exc.thisAmt).toBe(0)
    expect(exc.cumAmt).toBe(895500)
    expect(exc.complete).toBe(true)
  })

  it('carries every total across This, Cumulative and Balance', () => {
    const s = priceAbstract(SHEET, RATES)
    expect(s.totals.map(t => t.kind)).toEqual(['sub', 'gst', 'total', 'retention', 'net'])
    for (const t of s.totals) {
      expect(typeof t.thisBill).toBe('number')
      expect(typeof t.cumulative).toBe('number')
      expect(typeof t.balance).toBe('number')
    }
  })

  it('computes GST and retention off the BASIC, never off the gross', () => {
    const s = priceAbstract(SHEET, RATES)
    expect(row(s, 'gst').thisBill).toBe(38551.5)        // 18% of 2,14,175
    expect(row(s, 'total').thisBill).toBe(252726.5)
    expect(row(s, 'retention').thisBill).toBe(10708.75) // 5% of the basic
    expect(s.netThisBill).toBe(242017.75)
  })

  it('shows the rate beside the label, so nobody has to work it out', () => {
    const s = priceAbstract(SHEET, RATES)
    expect(row(s, 'gst').rate).toBe(18)
    expect(row(s, 'retention').rate).toBe(5)
  })

  // 60% of IN4 bills carry no tax; the sheet must handle a zero rate without
  // rendering a 0% line as if it were a deduction.
  it('handles a bill with no GST at all', () => {
    const s = priceAbstract(SHEET, { gstPct: 0, retentionPct: 0 })
    expect(row(s, 'gst').thisBill).toBe(0)
    expect(row(s, 'total').thisBill).toBe(s.basicThisBill)
    expect(s.netThisBill).toBe(s.basicThisBill)
  })

  // Retention on work not yet done is money that WILL be held, not money held.
  // Deducting it from the balance would understate what is left to earn.
  it('does not deduct retention from the balance column', () => {
    const s = priceAbstract(SHEET, RATES)
    expect(row(s, 'net').balance).toBe(row(s, 'total').balance)
  })

  it('flags a line measured past what was ordered', () => {
    const over = [line({ itemId: 11, orderedQty: 100, rate: 900, orderedAmt: 90000, priorQty: 0, priorAmt: 0, thisQty: 130 })]
    const s = priceAbstract(over, RATES)
    expect(s.lines[0].overrun).toBe(true)
    expect(s.lines[0].balQty).toBe(-30)
    expect(s.anyOverrun).toBe(true)
  })

  it('says what share of the order this bill is', () => {
    const s = priceAbstract(SHEET, RATES)
    // 2,14,175 of 11,09,675 ordered across these five lines.
    expect(s.pctOfOrder).toBe(19)
  })

  it('is all zeroes, and no NaN, on an untouched sheet', () => {
    const s = priceAbstract(SHEET.map(l => ({ ...l, thisQty: 0, priorQty: 0, priorAmt: 0 })), RATES)
    expect(s.basicThisBill).toBe(0)
    expect(s.netThisBill).toBe(0)
    for (const t of s.totals) expect(Number.isFinite(t.thisBill)).toBe(true)
  })
})

describe('seeding the sheet from the work order', () => {
  const boq = [
    { itemId: 12221, name: 'Waterproofing Works', description: 'Wet areas — membrane', uom: 'SqM', orderedQty: 180.19, rate: 896, orderedAmt: 161453 },
    { itemId: 12222, name: 'Waterproofing Works', description: null, uom: 'SqM', orderedQty: 324.11, rate: 875, orderedAmt: 283592 },
  ]

  it('opens with what is already measured, not a blank page', () => {
    const seeded = seedLines(boq, new Map([[12221, { qty: 84.76, amt: 75943 }]]))
    expect(seeded[0].priorQty).toBe(84.76)
    expect(seeded[0].thisQty).toBe(0)
    expect(seeded[1].priorQty).toBe(0)
    const s = priceAbstract(seeded, { gstPct: 18, retentionPct: 5 })
    expect(s.lines[0].balQty).toBe(95.43)   // 180.19 − 84.76 still to do
  })

  it('prefers the description, and falls back to the heading', () => {
    const seeded = seedLines(boq, new Map())
    expect(seeded[0].particular).toBe('Wet areas — membrane')
    expect(seeded[1].particular).toBe('Waterproofing Works')
  })

  it('numbers the rows from 1, for the # column', () => {
    expect(seedLines(boq, new Map()).map(l => l.sr)).toEqual([1, 2])
  })
})
