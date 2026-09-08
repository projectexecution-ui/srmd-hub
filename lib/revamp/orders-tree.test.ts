import { describe, it, expect } from 'vitest'
import {
  buildOrdersTree, contractorNames, lineNoteFor, poNumbersOf, sqlLiteral, NO_SOURCES,
  type AbstractRow, type WoRow, type IndentRow, type BoqRow, type Skill, type PartyReader,
  type Sources, type WoHeader, type PoHeader,
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
  category_id: 1, subcategory_id: 317, wo_value: 0, wo_gross_value: null, wo_paid_amt: 0,
  display_no: `WO/SRASSK/ND/2023-24/${o.wo_id}`, contractor_id: 9, ...o,
})
const indent = (skill_id: number | null, pos: unknown, material_name = 'Cement', uom = 'Bag'): IndentRow =>
  ({ skill_id, pos, material_name, uom })
const boq = (o: Partial<BoqRow> & { item_id: number; wo_id: number }): BoqRow => ({
  boq_name: 'Waterproofing and Allied Works', boq_subname: 'Waterproofing and Allied Works',
  description: 'Providing and laying box type waterproofing', uom: 'SqM',
  quantity: 1, rate: 0, amt: 0, ...o,
})
const build = (wos: WoRow[], indents: IndentRow[] = [], boqs: BoqRow[] = [], src: Sources = NO_SOURCES) =>
  buildOrdersTree(wos, indents, boqs, SKILLS, PARTIES, [], src)

/** IN4 header figures as the live read would return them. */
const header = (o: Partial<WoHeader> & { gross: number }): WoHeader =>
  ({ billed: 0, billsPaid: 0, advancePaid: 0, advanceRecovered: 0, retention: 0, ...o })
const live = (o: Partial<Sources>): Sources => ({ ...NO_SOURCES, in4: 'live', ...o })

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

    // Header figures as IN4 would return them: no GST on these, no advances,
    // no retention, so Paid is the bill payments alone.
    const woHeaders = new Map(wos.map(w => [w.wo_id, header({ gross: w.wo_value ?? 0, billsPaid: w.wo_paid_amt ?? 0 })]))
    const t = build(wos, indents, [], live({ woHeaders }))
    expect(t.totals.woCount).toBe(WO_COUNT)
    expect(t.totals.poCount).toBe(PO_COUNT)
    expect(t.totals.paid).toBe(WO_PAID)
    expect(t.totals.ordered).toBe(TOTAL_ORDERED)
    // Balance is the only derived figure on the screen: Ordered (full) −
    // Paid − Retention, over the orders IN4 gave a header for. The POs have
    // no header here, so they add nothing to it.
    expect(t.totals.balance).toBe(WO_ORDERED - WO_PAID)
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

describe('contractor names — in4_parties is keyed on (kind, id), not id', () => {
  // The real collision from production: id 3 is a contractor AND a supplier.
  const PARTIES = [
    { kind: 'contractor', id: 3, name: 'Desai Construction Pvt Ltd.' },
    { kind: 'supplier',   id: 3, name: 'BEYOND THE BEST SERVICES' },
    { kind: 'contractor', id: 7, name: 'Shree Builders' },
  ]

  /** A stub client that applies the filters the way PostgREST would and
   *  records which ones were asked for. */
  function stub() {
    const calls: Array<[string, string]> = []
    const reader: PartyReader = {
      from: () => ({
        select: () => ({
          eq: (col, v) => {
            calls.push([col, v])
            return {
              in: (_c, ids) => ({
                range: () => Promise.resolve({
                  data: PARTIES.filter(p => p[col as 'kind'] === v && ids.includes(p.id)).map(({ id, name }) => ({ id, name })),
                  error: null,
                }),
              }),
            }
          },
        }),
      }),
    }
    return { reader, calls }
  }

  it('filters on kind = contractor, so a colliding id resolves to the contractor', async () => {
    const { reader, calls } = stub()
    const { rows, error } = await contractorNames(reader, [{ contractor_id: 3 }, { contractor_id: 7 }, { contractor_id: null }])
    expect(error).toBeNull()
    expect(calls).toEqual([['kind', 'contractor']])
    expect(rows).toEqual([
      { id: 3, name: 'Desai Construction Pvt Ltd.' },
      { id: 7, name: 'Shree Builders' },
    ])
    // One row per id — the Map built from these can no longer pick a supplier.
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length)
  })

  it('skips the query when no work order carries a contractor', async () => {
    const { reader, calls } = stub()
    const res = await contractorNames(reader, [{ contractor_id: null }])
    expect(res).toEqual({ rows: [], error: null })
    expect(calls).toEqual([])
  })
})

describe('money — full order, Paid as money out with TDS, Retention apart, Balance like for like', () => {
  // WO/SRJT/SRAH/2025-26/41 exactly as IN4 held it on 8 Sep 2026: three
  // advances (1,86,99,999.58 with their TDS), one bill fully set against the
  // advance (recovered 1,03,18,792), one bill paid 38,42,296 after TDS 66,246.
  const SRAH41 = wo({ wo_id: 841, wo_value: 23770412.15, wo_gross_value: 28049086.34, wo_paid_amt: 3842296 })
  const SRAH41_HEADER = header({
    gross: 28049086.34, billed: 15182777.88, billsPaid: 3842296,
    advancePaid: 18699999.58, advanceRecovered: 10318792, retention: 955444,
  })
  const srah = live({ woHeaders: new Map([[841, SRAH41_HEADER]]), woBillTds: new Map([[841, 66246]]) })

  it('Paid = bills paid + TDS on bills + advances paid (which already carry their TDS)', () => {
    const o = build([SRAH41], [], [], srah).cats[0].subs[0].orders[0]
    expect(o.gross).toBe(28049086.34)
    expect(o.billed).toBe(15182777.88)
    expect(o.paid).toBeCloseTo(22608541.58, 2)
    expect(o.advanceOutstanding).toBeCloseTo(8381207.58, 2)
    expect(o.retention).toBe(955444)
  })

  it('Balance = Ordered − Paid − Retention, and equals (yet to bill) − (advance outstanding)', () => {
    const o = build([SRAH41], [], [], srah).cats[0].subs[0].orders[0]
    expect(o.balance).toBeCloseTo(4485100.76, 1)
    const yetToBill = 28049086.34 - 15182777.88
    expect(o.balance).toBeCloseTo(yetToBill - 8381207.58, 0)   // IN4 rounds its header to the rupee
  })

  it('the breakup names the before-GST value and the GST', () => {
    const o = build([SRAH41], [], [], srah).cats[0].subs[0].orders[0]
    expect(o.breakup).toBe('before GST ₹2,37,70,412 · GST ₹42,78,674')
  })

  it('WO 233: paid up, retention held, balance nil — not the −39,658 the first cut showed', () => {
    const WO233 = wo({ wo_id: 1427, wo_value: 305067.95, wo_gross_value: 359980.19, wo_paid_amt: 344726 })
    const src = live({ woHeaders: new Map([[1427, header({ gross: 359980.19, billed: 359980.17, billsPaid: 344726, retention: 15254 })]]) })
    const t = build([WO233], [], [], src)
    const o = t.cats[0].subs[0].orders[0]
    expect(o.paid).toBe(344726)
    expect(o.retention).toBe(15254)
    expect(o.balance).toBeCloseTo(0.19, 2)
    expect(t.totals.balance).toBeCloseTo(0.19, 2)
  })

  it('without IN4 the header columns are null — never zero — and Ordered falls back to the mirror gross', () => {
    const t = build([SRAH41])
    const o = t.cats[0].subs[0].orders[0]
    expect(o.gross).toBe(28049086.34)
    expect(o.billed).toBeNull(); expect(o.paid).toBeNull(); expect(o.retention).toBeNull(); expect(o.balance).toBeNull()
    expect(t.cats[0].balance).toBeNull()
    expect(t.in4).toBe('unavailable')
    expect(t.notes.some(n => n.includes('could not be reached'))).toBe(true)
  })

  it('a purchase order takes its FULL value from the IN4 header — GST and charges included', () => {
    // PO 1443 as BI.PURCHASE_ORDER_HEADER returns it: material 2,20,321 + GST 39,658 = 2,59,979.
    const po: PoHeader = { poId: 1443, value: 259979, material: 220321.1, tax: 39657.86, freight: 0, handling: 0, other: 0, paid: 0 }
    const t = build([], [indent(1, [{ poNo: 'DRAFT-PO/SRASSK/AB/2026-27/1443'.replace('DRAFT-', ''), amount: 220321.1, draft: false }])], [],
      live({ poHeaders: new Map([['PO/SRASSK/AB/2026-27/1443', po]]) }))
    const o = t.cats[0].subs[0].orders[0]
    expect(o.ordered).toBeCloseTo(220321.1, 2)   // the tracker's qty × rate
    expect(o.gross).toBe(259979)                  // IN4's full value
    expect(o.paid).toBe(0)
    expect(o.balance).toBe(259979)
    expect(o.breakup).toBe('material ₹2,20,321 · GST ₹39,658')
  })

  it('a PO with no header keeps its material value and blank money columns', () => {
    const t = build([], [indent(1, [{ poNo: 'PO/A/1', amount: 400, draft: false }])], [], live({}))
    const o = t.cats[0].subs[0].orders[0]
    expect(o.gross).toBeNull(); expect(o.paid).toBeNull(); expect(o.balance).toBeNull()
    expect(t.cats[0].gross).toBeNull()
    expect(t.notes.some(n => n.includes('1 purchase order'))).toBe(true)
  })

  it('a mixed category sums the full amounts of what IN4 gave a header for', () => {
    const po: PoHeader = { poId: 9, value: 472, material: 400, tax: 72, freight: 0, handling: 0, other: 0, paid: 100 }
    const t = build(
      [wo({ wo_id: 1, subcategory_id: 317, wo_value: 1000, wo_gross_value: 1180, wo_paid_amt: 500 })],
      [indent(1, [{ poNo: 'PO/A/1', amount: 400, draft: false }])],
      [],
      live({ woHeaders: new Map([[1, header({ gross: 1180, billsPaid: 500 })]]), poHeaders: new Map([['PO/A/1', po]]) }),
    )
    const civil = t.cats[0]
    expect(civil.ordered).toBe(1400)      // before tax, WO + PO
    expect(civil.gross).toBe(1652)        // 1180 + 472
    expect(civil.paid).toBe(600)          // 500 + 100
    expect(civil.balance).toBe(1052)      // 1652 − 600 − 0
  })
})

describe('the live IN4 read — what it asks for', () => {
  it('collects distinct non-draft PO numbers from the indent lines', () => {
    const nos = poNumbersOf([
      indent(1, [{ poNo: 'PO/A/1', amount: 1, draft: false }, { poNo: 'PO/A/2', amount: 1, draft: false }]),
      indent(1, [{ poNo: 'PO/A/1', amount: 1, draft: false }, { poNo: 'DRAFT-PO/A/3', amount: 1, draft: true }]),
    ])
    expect(nos.sort()).toEqual(['PO/A/1', 'PO/A/2'])
  })
  it('quotes a PO number for SQL and refuses anything that is not shaped like one', () => {
    expect(sqlLiteral('PO/SRASSK/NGH/2025-26/12')).toBe("'PO/SRASSK/NGH/2025-26/12'")
    expect(sqlLiteral("PO/1' OR 1=1 --")).toBeNull()
    expect(sqlLiteral('')).toBeNull()
  })
})

describe('lines that do not add up to the order value — IN4 discounts and amendments, said on the row', () => {
  it('says nothing when the lines tie to the value within a rupee', () => {
    expect(lineNoteFor(4, 116775, 116775.4)).toBeNull()
  })
  it('names the discount when the lines exceed the value (WO/SRJT/SRAH/2025-26/41: 13.98 %)', () => {
    const note = lineNoteFor(220, 27633587.6692, 23770412.15)
    expect(note).toContain('13.98%')
    expect(note).toContain('discount')
    expect(note).toContain('₹2,76,33,588')
  })
  it('a round discount prints without decimals (WO/SRASSK/NGH/2026-27/28: 25 %)', () => {
    expect(lineNoteFor(2, 24000, 18000)).toContain('a 25% discount')
  })
  it('calls it an amendment when the lines fall short of the value (WO/SRASSK/DAE/2023-24/75)', () => {
    const note = lineNoteFor(4, 116775, 157325)
    expect(note).toContain('amended')
    expect(note).not.toContain('discount')
  })
  it('an order with no lines at all gets no note — there is nothing to compare', () => {
    expect(lineNoteFor(0, 0, 5000)).toBeNull()
  })
  it('the note reaches the order row and the counts reach the notes', () => {
    const t = build(
      [wo({ wo_id: 9, wo_value: 18000, wo_gross_value: 18000, wo_paid_amt: 0 })],
      [],
      [boq({ item_id: 1, wo_id: 9, amt: 12000 }), boq({ item_id: 2, wo_id: 9, amt: 12000 })],
    )
    const o = t.cats[0].subs[0].orders[0]
    expect(o.lineTotal).toBe(24000)
    expect(o.lineNote).toContain('25% discount')
    expect(t.notes.some(n => n.includes('1 carries a discount in IN4'))).toBe(true)
  })
})

describe('certified per line item — the item-wise breakup of what has been billed', () => {
  // WO 623 item 6340, as the mirror holds it: 60,707.15 SqFt ordered, twelve
  // bills certifying 57,775.06 = 95.17 %.
  const ORDERED = boq({ item_id: 6340, wo_id: 623, uom: 'SqFt', quantity: 60707.15, rate: 100, amt: 6070715 })
  const bills = (n: number, qtyEach: number, amtEach: number): AbstractRow[] =>
    Array.from({ length: n }, (_, i) => ({
      wo_id: 623, item_id: 6340, executed_quantity: qtyEach, executed_amt: amtEach,
      bill_no: `B${i + 1}`, display_no: `RA/${i + 1}`, abstract_dt: `2025-0${(i % 9) + 1}-01`,
    }))
  const WO = wo({ wo_id: 623, wo_value: 6070715, wo_gross_value: 6070715, wo_paid_amt: 0 })

  it('sums quantity and amount over the bills on the line, joined on (wo_id, item_id)', () => {
    const t = buildOrdersTree([WO], [], [ORDERED], SKILLS, PARTIES, bills(12, 4814.588, 481458.8))
    const l = t.cats[0].subs[0].orders[0].lines[0]
    expect(l.certifiedQty).toBeCloseTo(57775.06, 1)
    expect(l.certifiedAmt).toBeCloseTo(5777505.6, 0)
    expect(l.bills).toHaveLength(12)
    expect(Math.round((l.certifiedQty! / l.qty!) * 100)).toBe(95)
  })

  it('a line with no bill shows null, never zero — IN4 holds nothing against it', () => {
    const t = buildOrdersTree([WO], [], [ORDERED], SKILLS, PARTIES, [])
    const l = t.cats[0].subs[0].orders[0].lines[0]
    expect(l.certifiedQty).toBeNull()
    expect(l.certifiedAmt).toBeNull()
    expect(t.cats[0].subs[0].orders[0].certifiedAmt).toBeNull()
  })

  it("a bill on another order's item with the same item_id does not leak across orders", () => {
    const other: AbstractRow = { wo_id: 999, item_id: 6340, executed_quantity: 5, executed_amt: 500, bill_no: 'X', display_no: null, abstract_dt: null }
    const t = buildOrdersTree([WO], [], [ORDERED], SKILLS, PARTIES, [other])
    expect(t.cats[0].subs[0].orders[0].lines[0].certifiedQty).toBeNull()
  })

  it('the order carries the sum of its billed lines, and bills read oldest first', () => {
    const second = boq({ item_id: 7, wo_id: 623, amt: 1000 })
    const abs: AbstractRow[] = [
      { wo_id: 623, item_id: 6340, executed_quantity: 10, executed_amt: 1000, bill_no: 'B2', display_no: null, abstract_dt: '2025-06-01' },
      { wo_id: 623, item_id: 6340, executed_quantity: 5, executed_amt: 500, bill_no: 'B1', display_no: null, abstract_dt: '2025-01-01' },
    ]
    const t = buildOrdersTree([WO], [], [ORDERED, second], SKILLS, PARTIES, abs)
    const o = t.cats[0].subs[0].orders[0]
    expect(o.certifiedAmt).toBe(1500)          // only the billed line counts
    expect(o.lines[0].bills.map(b => b.billNo)).toEqual(['B1', 'B2'])
    expect(o.lines[1].certifiedAmt).toBeNull()
  })

  it('purchase-order lines never carry certified figures — the PO feed has none', () => {
    const t = build([], [indent(1, [{ poNo: 'PO/A/1', amount: 400, draft: false, qty: 4, rate: 100 }])])
    const l = t.cats[0].subs[0].orders[0].lines[0]
    expect(l.certifiedQty).toBeNull(); expect(l.bills).toEqual([])
  })
})
