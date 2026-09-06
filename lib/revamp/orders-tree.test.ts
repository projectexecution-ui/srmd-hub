import { describe, it, expect } from 'vitest'
import { buildOrdersTree, type WoRow, type IndentRow } from './orders-tree'

// Names as IN4 holds them, for the ids used below.
const NAMES = new Map<number, string>([
  [1, '03 Civil'],
  [317, '317 Civil Contractor Cost'],
  [324, '324 Design Change Extra Work'],
  [267, '01 Site Pre-lims'],
  [102, '102 Porta Cabins'],
  [323, '08 Plumbing Works'],
])

const wo = (o: Partial<WoRow> & { wo_id: number }): WoRow => ({
  category_id: 1, subcategory_id: 317, wo_value: 0, wo_paid_amt: 0, ...o,
})
const indent = (skill_id: number | null, pos: unknown): IndentRow => ({ skill_id, pos })

describe('buildOrdersTree — the traps in IN4 order data', () => {
  it('THE pos TRAP: a line can carry TWO purchase orders', () => {
    // 19 of NGH B's lines do. `pos->0` is the obvious thing to write and it
    // silently drops the second one on every one of them.
    const t = buildOrdersTree([], [
      indent(1, [
        { poNo: 'PO/A/1', amount: 100000, draft: false },
        { poNo: 'PO/A/2', amount: 250000, draft: false },
      ]),
    ], NAMES)
    expect(t.totals.ordered).toBe(350000)
    expect(t.totals.poCount).toBe(2)
  })

  it('counts DISTINCT po numbers, not lines — 402 lines were only 74 orders', () => {
    const t = buildOrdersTree([], [
      indent(1, [{ poNo: 'PO/A/1', amount: 100, draft: false }]),
      indent(1, [{ poNo: 'PO/A/1', amount: 200, draft: false }]),
      indent(1, [{ poNo: 'PO/A/1', amount: 300, draft: false }]),
    ], NAMES)
    expect(t.totals.poCount).toBe(1)
    // The money is still every line's, only the COUNT is deduplicated.
    expect(t.totals.ordered).toBe(600)
  })

  it('excludes drafts from the money and says how many', () => {
    const t = buildOrdersTree([], [
      indent(1, [
        { poNo: 'PO/A/1', amount: 500000, draft: false },
        { poNo: 'PO/A/2', amount: 10079, draft: true },
      ]),
    ], NAMES)
    expect(t.totals.ordered).toBe(500000)
    expect(t.totals.poCount).toBe(1)
    expect(t.notes.some(n => n.includes('1 draft purchase-order line'))).toBe(true)
    expect(t.notes.some(n => n.includes('10,079'))).toBe(true)
  })

  it('keeps a work order with NO sub-category, on a row that says so', () => {
    // 6 of NGH B's 29. Dropping them would lose money from a total that still
    // claims to be the project's.
    const t = buildOrdersTree([
      wo({ wo_id: 1, subcategory_id: 317, wo_value: 1000, wo_paid_amt: 400 }),
      wo({ wo_id: 2, subcategory_id: null, wo_value: 500, wo_paid_amt: 100 }),
    ], [], NAMES)
    const civil = t.cats.find(c => c.name === '03 Civil')!
    expect(civil.ordered).toBe(1500)
    const orphan = civil.subs.find(s => s.unassigned)!
    expect(orphan.name).toBe('No sub-category in IN4')
    expect(orphan.ordered).toBe(500)
    expect(t.notes.some(n => n.includes('no sub-category in IN4'))).toBe(true)
  })

  it('puts POs on their own category-level row, never inside a sub-category', () => {
    // IN4 gives an indent line one skill_id, and it is a TOP-LEVEL category.
    // Placing POs under a work order's sub-category would be invented detail.
    const t = buildOrdersTree(
      [wo({ wo_id: 1, subcategory_id: 317, wo_value: 1000, wo_paid_amt: 0 })],
      [indent(1, [{ poNo: 'PO/A/1', amount: 400, draft: false }])],
      NAMES,
    )
    const civil = t.cats.find(c => c.name === '03 Civil')!
    const po = civil.subs.find(s => s.kind === 'po')!
    expect(po.name).toBe('Purchase orders')
    expect(po.ordered).toBe(400)
    // And it carries no paid figure, because IN4's PO feed has none.
    expect(po.paid).toBeNull()
  })

  it('never shows a zero where IN4 holds no figure', () => {
    const t = buildOrdersTree([], [indent(1, [{ poNo: 'PO/A/1', amount: 400, draft: false }])], NAMES)
    const civil = t.cats.find(c => c.name === '03 Civil')!
    // The whole category is POs, so paid is unknown — null, not 0.
    expect(civil.paid).toBeNull()
  })

  it('an unmapped skill id still shows, labelled by its id rather than dropped', () => {
    const t = buildOrdersTree([wo({ wo_id: 1, category_id: 9999, wo_value: 700 })], [], NAMES)
    expect(t.cats[0].name).toBe('Category 9999')
    expect(t.totals.ordered).toBe(700)
  })

  it('orders categories by value, biggest first', () => {
    const t = buildOrdersTree([
      wo({ wo_id: 1, category_id: 267, subcategory_id: 102, wo_value: 100 }),
      wo({ wo_id: 2, category_id: 1, subcategory_id: 317, wo_value: 900 }),
    ], [], NAMES)
    expect(t.cats.map(c => c.name)).toEqual(['03 Civil', '01 Site Pre-lims'])
  })
})

describe('buildOrdersTree — NGH B, against the live mirror', () => {
  // Read from Supabase on 7 Sept 2026 for sub-project 12 (NGH B):
  //   29 work orders   ordered ₹9,18,43,330   paid ₹6,30,47,730
  //   72 purchase orders (398 live lines)     ordered ₹97,81,785
  //   total ordered                           ₹10,16,25,115
  const WO_COUNT = 29
  const WO_ORDERED = 91_843_330
  const WO_PAID = 63_047_730
  const PO_COUNT = 72
  const PO_ORDERED = 9_781_785
  const TOTAL_ORDERED = 101_625_115

  it('reproduces the project totals', () => {
    // One work order carrying the whole WO position, one PO line per distinct
    // number carrying the whole PO position — the totals are what is asserted.
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

    const t = buildOrdersTree(wos, indents, NAMES)
    expect(t.totals.woCount).toBe(WO_COUNT)
    expect(t.totals.poCount).toBe(PO_COUNT)
    expect(t.totals.paid).toBe(WO_PAID)
    expect(t.totals.ordered).toBe(TOTAL_ORDERED)
    // Balance is the only derived figure on the screen, and it is a
    // subtraction of two amounts IN4 holds.
    expect(t.totals.ordered - t.totals.paid).toBe(38_577_385)
  })
})
