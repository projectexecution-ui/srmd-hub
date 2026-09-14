import { describe, it, expect } from 'vitest'
import { priceAbstract, seedLines, pickRate, type MakerLine } from './maker'

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

describe('which rate the sheet opens on', () => {
  // The flaw Aksha caught. WO/SRASSK/SQ/2023-24/7 has 27 bills carrying 0% or
  // 18% GST and 0% or 5% retention. Blending them gave "GST @ 14.4%" and
  // "Retention @ 4%" — rates that exist on no bill anywhere, pre-filled into
  // the field that computes the tax.
  const mixed = [
    { on: '2024-03-01', part: 0, whole: 500000 },       // no tax
    { on: '2024-06-01', part: 90000, whole: 500000 },   // 18%
    { on: '2024-09-01', part: 0, whole: 400000 },       // no tax
    { on: '2025-01-01', part: 180000, whole: 1000000 }, // 18%
  ]

  it('never invents a blended rate', () => {
    const p = pickRate(mixed, 18)
    // The blend of these four is 14.4%. It must not appear.
    expect(p.pct).not.toBe(14.4)
    expect([0, 18]).toContain(p.pct)
  })

  it('opens on what the LAST bill carried', () => {
    expect(pickRate(mixed, 18).pct).toBe(18)
    const endsUntaxed = [...mixed, { on: '2025-06-01', part: 0, whole: 300000 }]
    expect(pickRate(endsUntaxed, 18).pct).toBe(0)
  })

  it('says the order disagrees, so it reads as a decision not a default', () => {
    const p = pickRate(mixed, 18)
    expect(p.others).toEqual([0])
    expect(p.seen).toBe(2)
    expect(p.total).toBe(4)
    expect(p.basis).toBe('latest')
  })

  it('stays quiet when every bill agrees', () => {
    const p = pickRate([
      { on: '2024-01-01', part: 90000, whole: 500000 },
      { on: '2024-02-01', part: 18000, whole: 100000 },
    ], 18)
    expect(p.pct).toBe(18)
    expect(p.others).toEqual([])
    expect(p.seen).toBe(2)
  })

  // A deduction that does not divide cleanly is an adjustment, not a rate, and
  // must not become the default for the next bill.
  it('ignores a bill whose deduction is not a rate at all', () => {
    const p = pickRate([
      { on: '2024-01-01', part: 90000, whole: 500000 },  // clean 18%
      { on: '2024-05-01', part: 11373, whole: 100000 },  // 11.373% — not a rate
    ], 5)
    expect(p.pct).toBe(18)
    expect(p.total).toBe(1)
  })

  it('falls back and SAYS it is a fallback when nothing is usable', () => {
    const p = pickRate([{ on: '2024-01-01', part: 11373, whole: 100000 }], 18)
    expect(p).toMatchObject({ pct: 18, basis: 'default', seen: 0 })
  })

  it('treats a genuinely untaxed order as 0%, not as the 18% default', () => {
    // 60% of IN4 bills carry no tax. Defaulting those to 18% would add lakhs.
    const p = pickRate([
      { on: '2024-01-01', part: 0, whole: 500000 },
      { on: '2024-02-01', part: 0, whole: 250000 },
    ], 18)
    expect(p.pct).toBe(0)
    expect(p.basis).toBe('latest')
  })

  it('copes with an order that has no bills yet', () => {
    expect(pickRate([], 18)).toMatchObject({ pct: 18, basis: 'default', total: 0 })
  })
})
