import { describe, it, expect } from 'vitest'
import {
  buildOrdersTree,
  type WoRow, type IndentRow, type BoqRow, type Skill,
} from './orders-tree'

// Real IN4 skills, with the codes that decide the sequence. Categories have
// parent 0; the rest are their sub-categories.
const SKILLS = new Map<number, Skill>([
  [267, { id: 267, name: '01 Site Pre-lims', code: '01' }],
  [1, { id: 1, name: '03 Civil', code: '03' }],
  [312, { id: 312, name: '07 Electrical Works', code: '07' }],
  [323, { id: 323, name: '08 Plumbing Works', code: '08' }],
  [324, { id: 324, name: '09 Fire Fighting Works', code: '09' }],
  [338, { id: 338, name: '12 Finishes', code: '12' }],
  [596, { id: 596, name: '56 Mock Up Expense', code: '56' }],
  [315, { id: 315, name: '702 Electrical Conducting & Wiring Works', code: '702' }],
  [317, { id: 317, name: '703 Switches & Sockets', code: '703' }],
  [507, { id: 507, name: '806 Water Cooler and RO', code: '806' }],
])
const PARTIES = new Map<number, string>([[9, 'ACME Constructions'], [11, 'Sonal Ceramics']])

const wo = (o: Partial<WoRow> & { wo_id: number }): WoRow => ({
  category_id: 1, subcategory_id: 317, wo_value: 0, wo_paid_amt: 0,
  display_no: `WO/SRASSK/ND/2023-24/${o.wo_id}`, contractor_id: 9, ...o,
})
const indent = (skill_id: number | null, pos: unknown, material_name = 'Cement', uom = 'Bag'): IndentRow =>
  ({ skill_id, pos, material_name, uom })
const boq = (o: Partial<BoqRow> & { item_id: number; wo_id: number }): BoqRow => ({
  boq_name: 'Waterproofing and Allied Works', boq_subname: 'Waterproofing and Allied Works',
  description: 'Providing and laying box type waterproofing', uom: 'SqM',
  quantity: 1, rate: 0, amt: 0, ...o,
})
const build = (wos: WoRow[], indents: IndentRow[] = [], boqs: BoqRow[] = []) =>
  buildOrdersTree(wos, indents, boqs, SKILLS, PARTIES)

describe('sequence — IN4 code order, the same spine as the Internal Estimate', () => {
  it('orders categories by CODE, not by value', () => {
    // The first cut sorted biggest-first, which put this tree in a different
    // order from every other screen and from the Excel read beside it.
    const t = build([
      wo({ wo_id: 1, category_id: 338, subcategory_id: null, wo_value: 9_000_000 }), // 12 Finishes
      wo({ wo_id: 2, category_id: 267, subcategory_id: null, wo_value: 10_000 }),    // 01 Site Pre-lims
      wo({ wo_id: 3, category_id: 1, subcategory_id: null, wo_value: 500_000 }),     // 03 Civil
    ])
    expect(t.cats.map(c => c.name)).toEqual(['01 Site Pre-lims', '03 Civil', '12 Finishes'])
  })

  it('compares codes NUMERICALLY, so 09 comes before 12', () => {
    // As text, "12" sorts before "9". IN4 zero-pads some codes and not others.
    const t = build([
      wo({ wo_id: 1, category_id: 338, subcategory_id: null, wo_value: 1 }), // 12
      wo({ wo_id: 2, category_id: 324, subcategory_id: null, wo_value: 1 }), // 09
      wo({ wo_id: 3, category_id: 596, subcategory_id: null, wo_value: 1 }), // 56
    ])
    expect(t.cats.map(c => c.code)).toEqual(['09', '12', '56'])
  })

  it('orders sub-categories by code too, with the unassigned bucket last', () => {
    const t = build([
      wo({ wo_id: 1, category_id: 312, subcategory_id: 317, wo_value: 1 }),  // 703
      wo({ wo_id: 2, category_id: 312, subcategory_id: null, wo_value: 1 }), // no sub
      wo({ wo_id: 3, category_id: 312, subcategory_id: 315, wo_value: 1 }),  // 702
    ])
    const subs = t.cats[0].subs.map(s => s.name)
    expect(subs[0]).toBe('702 Electrical Conducting & Wiring Works')
    expect(subs[1]).toBe('703 Switches & Sockets')
    expect(subs[2]).toBe('No sub-category in IN4')
  })

  it('puts the PO row after the work-order sub-categories but before unassigned', () => {
    const t = build(
      [
        wo({ wo_id: 1, category_id: 312, subcategory_id: 315, wo_value: 1 }),
        wo({ wo_id: 2, category_id: 312, subcategory_id: null, wo_value: 1 }),
      ],
      [indent(312, [{ poNo: 'PO/1', amount: 100, draft: false }])],
    )
    expect(t.cats[0].subs.map(s => s.kind)).toEqual(['wo', 'po', 'wo'])
    expect(t.cats[0].subs[2].unassigned).toBe(true)
  })
})

describe('the traps in IN4 order data', () => {
  it('THE pos TRAP: a line can carry TWO purchase orders', () => {
    // 19 of NGH B's lines do. `pos->0` is the obvious thing to write and it
    // silently drops the second on every one of them.
    const t = build([], [indent(1, [
      { poNo: 'PO/A/1', amount: 100000, draft: false },
      { poNo: 'PO/A/2', amount: 250000, draft: false },
    ])])
    expect(t.totals.ordered).toBe(350000)
    expect(t.totals.poCount).toBe(2)
  })

  it('counts DISTINCT po numbers, not lines — 402 lines were only 74 orders', () => {
    const t = build([], [
      indent(1, [{ poNo: 'PO/A/1', amount: 100, draft: false }]),
      indent(1, [{ poNo: 'PO/A/1', amount: 200, draft: false }]),
      indent(1, [{ poNo: 'PO/A/1', amount: 300, draft: false }]),
    ])
    expect(t.totals.poCount).toBe(1)
    expect(t.totals.ordered).toBe(600)
    // ...and the three lines are the ONE order's items.
    expect(t.cats[0].subs[0].orders[0].lines).toHaveLength(3)
  })

  it('excludes drafts from the money and says how many', () => {
    const t = build([], [indent(1, [
      { poNo: 'PO/A/1', amount: 500000, draft: false },
      { poNo: 'PO/A/2', amount: 10079, draft: true },
    ])])
    expect(t.totals.ordered).toBe(500000)
    expect(t.totals.poCount).toBe(1)
    expect(t.notes.some(n => n.includes('1 draft purchase-order line'))).toBe(true)
    expect(t.notes.some(n => n.includes('10,079'))).toBe(true)
  })

  it('keeps a work order with NO sub-category, on a row that says so', () => {
    const t = build([
      wo({ wo_id: 1, subcategory_id: 317, wo_value: 1000, wo_paid_amt: 400 }),
      wo({ wo_id: 2, subcategory_id: null, wo_value: 500, wo_paid_amt: 100 }),
    ])
    const civil = t.cats.find(c => c.name === '03 Civil')!
    expect(civil.ordered).toBe(1500)
    const orphan = civil.subs.find(s => s.unassigned)!
    expect(orphan.ordered).toBe(500)
    expect(t.notes.some(n => n.includes('no sub-category in IN4'))).toBe(true)
  })

  it('never shows a zero where IN4 holds no figure', () => {
    const t = build([], [indent(1, [{ poNo: 'PO/A/1', amount: 400, draft: false }])])
    // A category that is all POs has no paid figure at all — null, not 0.
    expect(t.cats[0].paid).toBeNull()
    expect(t.cats[0].subs[0].orders[0].paid).toBeNull()
  })

  it('an unmapped skill id still shows, labelled by its id rather than dropped', () => {
    const t = build([wo({ wo_id: 1, category_id: 9999, subcategory_id: null, wo_value: 700 })])
    expect(t.cats[0].name).toBe('Category 9999')
    expect(t.totals.ordered).toBe(700)
  })
})

describe('the two deeper levels — orders and their line items', () => {
  it('hangs BOQ lines under their work order, with unit, qty and rate', () => {
    const t = build(
      [wo({ wo_id: 7, subcategory_id: 317, wo_value: 204142.4, wo_paid_amt: 100000 })],
      [],
      [boq({ item_id: 1, wo_id: 7, quantity: 127.589, rate: 1600, amt: 204142.4 })],
    )
    const order = t.cats[0].subs[0].orders[0]
    expect(order.ref).toBe('WO/SRASSK/ND/2023-24/7')
    expect(order.party).toBe('ACME Constructions')
    expect(order.lines).toHaveLength(1)
    expect(order.lines[0]).toMatchObject({ uom: 'SqM', qty: 127.589, rate: 1600, amount: 204142.4 })
    expect(t.totals.lineCount).toBe(1)
  })

  it('a work order with no BOQ rows still shows, with no items under it', () => {
    const t = build([wo({ wo_id: 8, subcategory_id: 317, wo_value: 5000 })])
    expect(t.cats[0].subs[0].orders[0].lines).toEqual([])
    expect(t.totals.lineCount).toBe(0)
  })

  it('a PO line item carries the quantity and rate from that PO, not the indent', () => {
    const t = build([], [indent(1, [
      { poNo: 'PO/SRASSK/NGH/2026-27/87', amount: 1054620, qty: 20088, rate: 52.5, draft: false, supplier: 'SONAL CERAMICS' },
    ], 'Vitrified Tiles', 'Sqft')])
    const order = t.cats[0].subs[0].orders[0]
    expect(order.ref).toBe('PO/SRASSK/NGH/2026-27/87')
    expect(order.party).toBe('SONAL CERAMICS')
    expect(order.lines[0]).toMatchObject({ name: 'Vitrified Tiles', uom: 'Sqft', qty: 20088, rate: 52.5, amount: 1054620 })
  })

  it('orders within a sub-category are listed in order number sequence', () => {
    const t = build([
      wo({ wo_id: 10, subcategory_id: 317, display_no: 'WO/X/10', wo_value: 1 }),
      wo({ wo_id: 2, subcategory_id: 317, display_no: 'WO/X/2', wo_value: 1 }),
    ])
    expect(t.cats[0].subs[0].orders.map(o => o.ref)).toEqual(['WO/X/2', 'WO/X/10'])
  })
})

describe('NGH B, against the live mirror', () => {
  // Read from Supabase on 7 Sept 2026 for sub-project 12 (NGH B):
  //   29 work orders   ordered ₹9,18,43,330   paid ₹6,30,47,730
  //   206 BOQ lines summing to ₹9,18,43,330 — EXACTLY the work-order value
  //   72 purchase orders (398 live lines)     ordered ₹97,81,785
  const WO_COUNT = 29
  const WO_ORDERED = 91_843_330
  const WO_PAID = 63_047_730
  const PO_COUNT = 72
  const PO_ORDERED = 9_781_785
  const TOTAL_ORDERED = 101_625_115

  it('reproduces the project totals', () => {
    const wos: WoRow[] = Array.from({ length: WO_COUNT }, (_, i) => wo({
      wo_id: i + 1,
      wo_value: i === 0 ? WO_ORDERED : 0,
      wo_paid_amt: i === 0 ? WO_PAID : 0,
    }))
    const indents: IndentRow[] = [indent(1, Array.from({ length: PO_COUNT }, (_, i) => ({
      poNo: `PO/SRASSK/NGH/2026-27/${i + 1}`,
      amount: i === 0 ? PO_ORDERED : 0,
      draft: false,
    })))]

    const t = build(wos, indents)
    expect(t.totals.woCount).toBe(WO_COUNT)
    expect(t.totals.poCount).toBe(PO_COUNT)
    expect(t.totals.paid).toBe(WO_PAID)
    expect(t.totals.ordered).toBe(TOTAL_ORDERED)
    // Balance is the only derived figure on the screen, and it is a
    // subtraction of two amounts IN4 holds.
    expect(t.totals.ordered - t.totals.paid).toBe(38_577_385)
  })

  it("the BOQ lines add up to the work order's value — the deepest level ties to the top", () => {
    // 206 lines summing to the same ₹9,18,43,330 the orders carry. Modelled
    // here as three lines on one order, which is the property that matters.
    const t = build(
      [wo({ wo_id: 1, subcategory_id: 317, wo_value: WO_ORDERED, wo_paid_amt: WO_PAID })],
      [],
      [
        boq({ item_id: 1, wo_id: 1, amt: 41_843_330 }),
        boq({ item_id: 2, wo_id: 1, amt: 30_000_000 }),
        boq({ item_id: 3, wo_id: 1, amt: 20_000_000 }),
      ],
    )
    const order = t.cats[0].subs[0].orders[0]
    const lineSum = order.lines.reduce((s, l) => s + l.amount, 0)
    expect(lineSum).toBe(WO_ORDERED)
    expect(order.ordered).toBe(WO_ORDERED)
  })
})
