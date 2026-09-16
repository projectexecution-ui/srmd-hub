import { describe, it, expect } from 'vitest'
import { buildAbstractSheet, earlierColumns, type AbstractLine, type BoqLine, type LadderBill } from './abstract'

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

/** Aksha, 15 Sep 2026: "all RA bills should show not only previous Bill total".
 *
 *  A single Previous column says how much came before but not which bill it
 *  came on — and on a running account that is the thing being checked: whether
 *  this bill is re-measuring what an earlier one already claimed. */
describe('every earlier bill as its own column', () => {
  const THIRD: AbstractLine[] = [
    line({ abstractId: 2600, abstractNo: 'Abs/…/99', billNo: 'KP362SRA09', on: '2026-07-02', itemId: 12221, qty: 5, rate: 896, amt: 4480 }),
  ]

  it('lists the earlier bills oldest first, once each', () => {
    const s = buildAbstractSheet(THIRD, [...SECOND, ...FIRST], BOQ, null)
    expect(s.earlierBills.map(b => b.billNo)).toEqual(['KP362SRA51', 'KP362SRA06'])
  })

  it('puts each earlier bill quantity in its own slot, in that order', () => {
    const s = buildAbstractSheet(THIRD, [...SECOND, ...FIRST], BOQ, null)
    const row = s.rows.find(r => r.itemId === 12221)!
    // RA-1 measured 84.76, RA-2 measured 95.44, this bill adds 5.
    expect(row.history).toEqual([84.76, 95.44])
    expect(row.thisQty).toBe(5)
    expect(row.cumulativeQty).toBe(185.2)
  })

  it('shows a zero where an earlier bill did not touch that item', () => {
    const s = buildAbstractSheet(
      [line({ abstractId: 2600, billNo: 'X3', on: '2026-07-02', itemId: 12206, qty: 10, rate: 1132, amt: 11320 })],
      [...SECOND, ...FIRST], BOQ, null)
    // Item 12206 appears on neither earlier bill, so both slots are empty
    // rather than the column being dropped and the rows sliding left.
    expect(s.rows[0].history).toEqual([0, 0])
    expect(s.rows[0].history).toHaveLength(s.earlierBills.length)
  })

  it('has no columns at all on the first bill of an order', () => {
    const s = buildAbstractSheet(FIRST, [], BOQ, null)
    expect(s.earlierBills).toEqual([])
    for (const r of s.rows) expect(r.history).toEqual([])
  })
})

/** Aksha, 15 Sep 2026: "can u see there are so many RA - but the Abstract only
 *  shownh 2 or 3 RA".
 *
 *  Real shape, read off WO/SRET/WH/2025-26/210 on 15 Sep 2026. Nine bills on
 *  the register; seven abstracts, because IN4 answered the first three bills
 *  with ONE sheet numbered "RU-WH-CV/01,02 & 03":
 *
 *      RA-1  RU-WH-CV/01  ENP/…/181   31,27,174  ┐
 *      RA-2  RU-WH-CV/02  ENP/…/182    3,89,879  ├ one abstract, 70,09,244
 *      RA-3  RU-WH-CV/03  ENP/…/183   34,92,189  ┘
 *      RA-4  RU-WH-CV/04  ENP/…/268   75,05,440    Abs/…/217
 *
 *  Building the columns out of the abstracts alone gave two columns headed
 *  RA-1 and RA-2 — and the second of those is the bill the register calls
 *  RA-4. */
describe('the earlier columns come from the bill register', () => {
  const LADDER: LadderBill[] = [
    { ra: 1, invoiceNo: 'RU-WH-CV/01', on: '2025-09-16', certified: 3127174 },
    { ra: 2, invoiceNo: 'RU-WH-CV/02', on: '2025-09-16', certified: 389879.48 },
    { ra: 3, invoiceNo: 'RU-WH-CV/03', on: '2025-09-16', certified: 3492189.42 },
    { ra: 4, invoiceNo: 'RU-WH-CV/04', on: '2025-10-15', certified: 7505440.32 },
  ]
  const LUMPED: AbstractLine[] = [
    line({ abstractId: 1502, abstractNo: 'Abs/SRET/WH/2025-26/176', billNo: 'RU-WH-CV/01,02 & 03', on: '2025-09-11', itemId: 12221, qty: 40, rate: 896, amt: 4000000 }),
    line({ abstractId: 1502, abstractNo: 'Abs/SRET/WH/2025-26/176', billNo: 'RU-WH-CV/01,02 & 03', on: '2025-09-11', itemId: 12222, qty: 30, rate: 875, amt: 3009243 }),
  ]
  const FOURTH: AbstractLine[] = [
    line({ abstractId: 1589, abstractNo: 'Abs/SRET/WH/2025-26/217', billNo: 'RU-WH-CV/04', on: '2025-10-10', itemId: 12221, qty: 20, rate: 896, amt: 7505440 }),
  ]

  it('numbers a column the way the bills panel numbers it', () => {
    const { columns } = earlierColumns([...LUMPED, ...FOURTH], LADDER)
    expect(columns.map(c => c.label)).toEqual(['RA-1–3', 'RA-4'])
  })

  it('merges a run only when the money adds up, never by reading the text', () => {
    // Same abstract, same "01,02 & 03" wording, but a total that matches no run
    // of bills. It is then its own column with NO RA number — an invented one
    // would put it in a sequence the register does not have it in.
    const wrong = LUMPED.map(l => ({ ...l, amt: 11 }))
    const { columns } = earlierColumns([...wrong, ...FOURTH], LADDER)
    expect(columns.map(c => c.label)).toEqual([null, 'RA-1', 'RA-2', 'RA-3', 'RA-4'])
  })

  it('keeps a column for a bill IN4 never abstracted, and says so', () => {
    const { columns } = earlierColumns(FOURTH, LADDER)
    expect(columns.map(c => c.label)).toEqual(['RA-1', 'RA-2', 'RA-3', 'RA-4'])
    expect(columns.map(c => c.measured)).toEqual([false, false, false, true])
    // The unmeasured ones still carry the contractor's bill number off the
    // certificate, so the column is identifiable.
    expect(columns[0].billNo).toBe('RU-WH-CV/01')
  })

  it('puts the lumped abstract quantity under the merged column', () => {
    const s = buildAbstractSheet(
      [line({ abstractId: 1779, billNo: 'RU-WH-CV/05', on: '2025-11-25', itemId: 12221, qty: 7, rate: 896, amt: 6272 })],
      [...LUMPED, ...FOURTH], BOQ, null, LADDER)
    expect(s.earlierBills.map(b => b.label)).toEqual(['RA-1–3', 'RA-4'])
    const row = s.rows.find(r => r.itemId === 12221)!
    expect(row.history).toEqual([40, 20])
    expect(s.unmeasured).toBe(0)
  })

  it('counts the bills with no sheet, because their qty is missing from Cum', () => {
    const s = buildAbstractSheet(
      [line({ abstractId: 1779, billNo: 'RU-WH-CV/05', on: '2025-11-25', itemId: 12221, qty: 7, rate: 896, amt: 6272 })],
      FOURTH, BOQ, null, LADDER)
    expect(s.unmeasured).toBe(3)
    expect(s.rows[0].history).toHaveLength(4)
  })

  it('falls back to a column per abstract when no register is passed', () => {
    const s = buildAbstractSheet(THIRD_BILL, [...SECOND, ...FIRST], BOQ, null)
    expect(s.earlierBills.map(b => b.billNo)).toEqual(['KP362SRA51', 'KP362SRA06'])
    expect(s.earlierBills.map(b => b.label)).toEqual([null, null])
  })
})

const THIRD_BILL: AbstractLine[] = [
  line({ abstractId: 2600, abstractNo: 'Abs/…/99', billNo: 'KP362SRA09', on: '2026-07-02', itemId: 12221, qty: 5, rate: 896, amt: 4480 }),
]
