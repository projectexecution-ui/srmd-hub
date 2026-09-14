import { describe, it, expect } from 'vitest'
import { buildAbstractSheet, type AbstractLine, type BoqLine } from './abstract'

/** Real measurement, read from the mirror on 14 Sep 2026 — work order 1537,
 *  WO/SRASSK/NGH/2025-26/271, waterproofing, NGH B.
 *
 *  Two abstracts measure the same two items, and together they finish both:
 *
 *    Abs/…/481, 21 Mar, bill KP362SRA51   84.76 + 96.62  →  75,943 + 84,539
 *    Abs/…/68,  29 May, bill KP362SRA06   95.44 + 227.49 →  85,511 + 199,054
 *
 *  which reconciles to certificates ENP/…/500 (160,482) and ENP/…/91 (284,564),
 *  and lands the cumulative on the ordered quantity exactly. */
const BOQ: BoqLine[] = [
  { itemId: 12221, name: 'Waterproofing Works at Wet Areas, Toilet Areas', description: 'Wet areas — membrane', uom: 'SqM', orderedQty: 180.19, rate: 896, orderedAmt: 161453 },
  { itemId: 12222, name: 'Waterproofing Works at Wet Areas, Toilet Areas', description: 'Wet areas — screed', uom: 'SqM', orderedQty: 324.11, rate: 875, orderedAmt: 283592 },
  { itemId: 12206, name: 'Waterproofing Works at Terrace', description: 'Terrace — membrane', uom: 'SqM', orderedQty: 407.85, rate: 1132, orderedAmt: 461685 },
]

const line = (o: Partial<AbstractLine>): AbstractLine => ({
  abstractId: 2246, itemId: 12221, abstractNo: 'Abs/SRASSK/NGH/2025-26/481',
  billNo: 'KP362SRA51', on: '2026-03-21', qty: 84.76, rate: 896, amt: 75943, ...o,
})

const FIRST: AbstractLine[] = [
  line({}),
  line({ itemId: 12222, qty: 96.62, rate: 875, amt: 84539 }),
]
const SECOND: AbstractLine[] = [
  line({ abstractId: 2503, abstractNo: 'Abs/SRASSK/NGH/2025-26/68', billNo: 'KP362SRA06', on: '2026-05-29', itemId: 12221, qty: 95.44, rate: 896, amt: 85511 }),
  line({ abstractId: 2503, abstractNo: 'Abs/SRASSK/NGH/2025-26/68', billNo: 'KP362SRA06', on: '2026-05-29', itemId: 12222, qty: 227.49, rate: 875, amt: 199054 }),
]

describe('the abstract sheet', () => {
  it('reconciles to what IN4 certified for that bill', () => {
    const s = buildAbstractSheet(FIRST, [], BOQ, 160482)
    expect(s.thisBill).toBe(160482)
    expect(s.reconciles).toBe(true)
    expect(s.abstractNo).toBe('Abs/SRASSK/NGH/2025-26/481')
    expect(s.billNo).toBe('KP362SRA51')
  })

  it('tolerates IN4 rounding each line, and no more', () => {
    // 85,511 + 199,054 = 284,565 against 284,564 certified — one rupee, which
    // is rounding. A hundred rupees is not, and must be shown.
    const ok = buildAbstractSheet(SECOND, FIRST, BOQ, 284564)
    expect(ok.thisBill).toBe(284565)
    expect(ok.outBy).toBe(1)
    expect(ok.reconciles).toBe(true)
    expect(buildAbstractSheet(SECOND, FIRST, BOQ, 284464).reconciles).toBe(false)
  })

  // The whole point of a running-account bill: this quantity means nothing
  // without what came before it and what was ordered.
  it('builds the cumulative from the bills before it', () => {
    const s = buildAbstractSheet(SECOND, FIRST, BOQ, 284564)
    const membrane = s.rows.find(r => r.itemId === 12221)!
    expect(membrane.thisQty).toBe(95.44)
    expect(membrane.cumulativeQty).toBe(180.2)       // 84.76 + 95.44
    expect(membrane.orderedQty).toBe(180.19)
  })

  it('closes a line that this bill finishes', () => {
    const s = buildAbstractSheet(SECOND, FIRST, BOQ, 284564)
    const screed = s.rows.find(r => r.itemId === 12222)!
    // 96.62 + 227.49 = 324.11, exactly the ordered quantity.
    expect(screed.cumulativeQty).toBe(324.11)
    expect(screed.balanceQty).toBe(0)
    expect(screed.complete).toBe(true)
    expect(screed.overrun).toBe(false)
  })

  it('leaves a part-measured line open with its balance', () => {
    const s = buildAbstractSheet(FIRST, [], BOQ, 160482)
    const screed = s.rows.find(r => r.itemId === 12222)!
    expect(screed.cumulativeQty).toBe(96.62)
    expect(screed.balanceQty).toBe(227.49)
    expect(screed.complete).toBe(false)
  })

  it('flags a line measured beyond what was ordered', () => {
    const over = [line({ itemId: 12221, qty: 200, amt: 179200 })]
    const s = buildAbstractSheet(over, [], BOQ, 179200)
    const r = s.rows[0]
    expect(r.overrun).toBe(true)
    expect(r.balanceQty).toBeLessThan(0)
  })

  it('puts the biggest money on this bill first', () => {
    const s = buildAbstractSheet(SECOND, FIRST, BOQ, 284564)
    expect(s.rows.map(r => r.thisAmt)).toEqual([199054, 85511])
  })

  it('merges an item split across two lines of the same abstract', () => {
    const split = [line({ qty: 40, amt: 35840 }), line({ qty: 44.76, amt: 40103 })]
    const s = buildAbstractSheet(split, [], BOQ, 75943)
    expect(s.rows).toHaveLength(1)
    expect(s.rows[0].thisQty).toBe(84.76)
    expect(s.rows[0].thisAmt).toBe(75943)
  })

  it('still names an item the BOQ has no row for, rather than rendering blank', () => {
    const s = buildAbstractSheet([line({ itemId: 99999 })], [], BOQ, 75943)
    expect(s.rows[0].item).toBe('Item 99999')
    expect(s.rows[0].orderedQty).toBe(0)
  })

  // IN4 repeats one heading across a dozen BOQ lines; the description is what
  // tells them apart.
  it('prefers the description over the repeated heading', () => {
    expect(buildAbstractSheet(FIRST, [], BOQ, 160482).rows.map(r => r.item))
      .toEqual(['Wet areas — screed', 'Wet areas — membrane'])
  })
})
