import { describe, it, expect } from 'vitest'
import { parseInternalBudget, tabCodeMap } from './internal-budget-parse'
import type { SheetInput } from './excel-parse'

// ============================================================================
// Fixtures mirror the two real variants of the standard SRM Internal Budget:
//   V-CONSULTANTS (SRAH V9): money only in the Consultants Budget I/J pair.
//   V-INTERNAL (Vinay V4 / Welcome Centre V1): Consultants I/J AND the
//   preferred "Internal Estimated Budget" K/L pair; per-code working tabs.
// ============================================================================

const N = null

function consultantsOnlyGrid(): unknown[][] {
  return [
    ['Shrimad Rajchandra Mission, Dharampur'],
    [N],
    ['Standard Budget Format     Internal Budget', 'Awaiting Details'],
    ['', 'Consultant'],
    ['', 'Assumed'],
    ['Area 3215 SFT', N, N, 0, 'Sft.', N, N, N, 3215, 270034059],
    ['Work Category / Material Type / Expense Type', 'Sub Skill / Expense Sub Type', 'Specs', 'Makes', 'Base Rates', 'Amt', 'Cat Total', 'Rs/Sft', 'Consultants Budget'],
    [N, N, N, N, N, N, N, N, 'Itemwise Budget', 'Category Total'],
    ['01 Site Pre-lims', N, N, N, N, N, N, N, N, 0],
    [N, '101 Soil Investigation'],
    ['02 Earthworks - Building', N, N, N, N, N, N, N, N, 1064537],
    [N, '201 Excavation & Backfilling', N, N, N, N, N, N, 1064537],
    ['03 Civil ', N, N, N, N, N, N, N, N, 81375000],
    [N, '302 Steel Works ', N, N, N, N, N, N, 45028800],
    [N, '303 Concrete Work ', N, N, N, N, N, N, 36346200],
    ['Actual Staff Cost', N, N, N, N, N, N, N, N, 5000000],   // uncoded, money → skipped+reported
    ['Total Amount with GST (A)', N, N, N, N, N, N, N, 270034059, 270034059],
    ['Contingencies (B)'],
  ]
}

function internalPairGrid(): unknown[][] {
  return [
    ['Shrimad Rajchandra Mission, Dharampur'],
    [N],
    ['Standard Budget Format     Internal Budget', 'Awaiting Details'],
    ['', 'Consultant', N, N, N, N, N, N, 'Area (in sq. ft.)', 64000],
    ['', 'Assumed', N, N, N, N, N, N, 'Rate (in Rs. psf)', 4284],
    ['', 'Final', N, 0, 'Sft.'],
    ['Work Category / Material Type / Expense Type', 'Sub Skill / Expense Sub Type', 'Specs', 'Makes', 'Base Rates', 'Amt', 'Cat Total', 'Rs/Sft', 'Consultants Budget', N, 'Internal Estimated Budget '],
    [N, N, N, N, N, N, N, N, 'Itemwise Budget', 'Category Total', 'Itemwise Budget', 'Category Total'],
    ['01 Site Pre-lims', N, N, N, N, N, N, N, N, 0, N, 300000],
    [N, '101 Soil Investigation', N, N, N, N, N, N, 999999, N, 100000],   // consultants 999999 must NOT win
    [N, '104 Site Prelims Electrical Works', N, N, N, N, N, N, N, N, 100000],
    [N, '105 Site Prelims Plumbing Works', N, N, N, N, N, N, N, N, 100000],
    ['03 Civil', N, N, N, N, N, N, N, N, N, N, 90000000],
    [N, '302 Steel Works', N, N, N, N, N, N, N, N, 45000000],
    [N, '303 Concrete Work', N, N, N, N, N, N, N, N, 45000000],
    ['Total Amount with GST (A)', N, N, N, N, N, N, N, 0, 0, N, 90300000],
  ]
}

const WORKING_TAB_302: unknown[][] = [
  ['302 Steel Works — Working'],
  ['Item', 'Unit', 'Qty', 'Rate', 'Amount'],
  ['TMT FE500 slab steel', 'MT', 300, 80000, 24000000],
  ['TMT FE500 column steel', 'MT', 262.5, 80000, 21000000],
]

const V_CONSULTANTS: SheetInput[] = [
  { name: 'SUMMARY (2)', aoa: consultantsOnlyGrid() },
]

const V_INTERNAL: SheetInput[] = [
  { name: 'Vinay', aoa: internalPairGrid() },
  { name: '302 Steel Working', aoa: WORKING_TAB_302 },
  { name: 'ELECTRICAL COST', aoa: [['uncoded tab']] },
]

describe('parseInternalBudget — consultants-only variant (SRAH shape)', () => {
  const b = parseInternalBudget(V_CONSULTANTS)

  it('parses and picks the Consultants pair (only pair with money)', () => {
    expect(b.parseOk).toBe(true)
    expect(b.moneySource).toBe('consultants')
  })
  it('extracts disciplines + sub-skills with amounts; zero rows skipped', () => {
    const codes = b.disciplines.map(d => d.code)
    expect(codes).toContain('02')
    expect(codes).toContain('03')
    const civil = b.disciplines.find(d => d.code === '03')!
    expect(civil.name).toBe('Civil')
    expect(civil.subSkills.map(s => s.code)).toEqual(['302', '303'])
    expect(civil.subSkills[0].name).toBe('Steel Works')
    expect(civil.subSkills[0].amount).toBe(45_028_800)
    // 101 had no money → dropped
    const pre = b.disciplines.find(d => d.code === '01')
    expect(pre?.subSkills ?? []).toHaveLength(0)
  })
  it('grand total from the "Total Amount with GST" footer', () => {
    expect(b.grandTotal).toBe(270_034_059)
    expect(b.grandTotalSource).toBe('footer')
  })
  it('area found from the Sft. title row', () => {
    expect(b.areaSft).toBe(3215)
  })
  it('uncoded category lumps are captured as sub-skills, never lost', () => {
    const lump = b.disciplines.find(d => d.name === 'Actual Staff Cost')!
    expect(lump.code).toBeNull()
    expect(lump.subSkills).toHaveLength(1)
    expect(lump.subSkills[0].amount).toBe(5_000_000)
    expect(lump.subSkills[0].remark).toMatch(/lump/i)
    expect(b.skipped).toHaveLength(0)
  })
  it('discipline reconciliation delta computed', () => {
    const civil = b.disciplines.find(d => d.code === '03')!
    expect(civil.reconDelta).toBe(0) // 45028800 + 36346200 = 81375000
  })
})

describe('parseInternalBudget — Internal Estimated pair variant (Vinay shape)', () => {
  const b = parseInternalBudget(V_INTERNAL)

  it('prefers the Internal Estimated pair over Consultants', () => {
    expect(b.moneySource).toBe('internal_estimated')
    const soil = b.disciplines.find(d => d.code === '01')!.subSkills.find(s => s.code === '101')!
    expect(soil.amount).toBe(100_000) // NOT the 999,999 consultants figure
  })
  it('area from the "Area (in sq. ft.)" label', () => {
    expect(b.areaSft).toBe(64_000)
  })
  it('grand total from footer (internal pair category col)', () => {
    expect(b.grandTotal).toBe(90_300_000)
  })
  it('attaches the code-named working tab to 302', () => {
    const steel = b.disciplines.find(d => d.code === '03')!.subSkills.find(s => s.code === '302')!
    expect(steel.workingSheetName).toBe('302 Steel Working')
    expect(steel.working!.length).toBeGreaterThanOrEqual(2)
    const line = steel.working!.find(w => (w.description ?? '').includes('slab steel'))!
    expect(line.amount).toBe(24_000_000)
    expect(line.qty).toBe(300)
    expect(line.rate).toBe(80_000)
  })
  it('sub-skills without a matching tab carry no working', () => {
    const conc = b.disciplines.find(d => d.code === '03')!.subSkills.find(s => s.code === '303')!
    expect(conc.working).toBeNull()
  })
})

// Infra variant (NGH-Infra V8 shape): anchors shifted to B/C, "Internal
// Budget" pair at H/I, prose section headings with category totals, and
// most money on UNCODED prose rows with remarks in col K.
function infraGrid(): unknown[][] {
  return [
    ['Shrimad Rajchandra Mission Dharampur'],
    [N, 'NGH INFRA', 'Trust: SRASSK'],
    [N, 'Road Area (sq ft)', 143269],
    [N, 'Work Category / Material Type / Expense Type', 'Sub Skill / Expense Sub Type', 'Incharge', 'CS Budget', N, N, 'Internal Budget'],
    [N, N, N, N, 'Itemwise Budget', 'Category Total', 'Rs./SFT', 'Itemwise Budget', 'Category Total', 'Rs./SFT', 'Remark'],
    [N, 'Compound Wall', N, 'Mayank', N, N, N, N, 17652800, 123.2],
    [N, N, '1605 Compound Wall', N, N, N, N, 17652800, N, 0, '800m - WC to DN Anx'],
    [N, 'Retaining Walls & Gabion Walls', N, 'Mayank', N, N, N, N, 52600648, 367.1],
    [N, N, 'RCC Retaining Walls - C', N, N, N, N, 35382560, N, 0, 'Billed under Building RW'],
    [N, N, 'Gabion Wall', N, N, N, N, 8000000, N, 0, 'As per actual'],
    [N, N, 'RCC Retaining Walls - A', N, N, N, N, 7681740, N, 0],
    [N, N, 'RCC Retaining Walls - B', N, N, N, N, 1536348, N, 0],
    [N, 'Total Amount with GST (A)', N, N, N, N, N, N, 70253448],
  ]
}

describe('parseInternalBudget — infra variant (prose sections, uncoded rows)', () => {
  const b = parseInternalBudget([{ name: 'NGH Infra Bud CS', aoa: infraGrid() }])

  it('captures ALL money including uncoded prose rows — nothing lost', () => {
    expect(b.parseOk).toBe(true)
    expect(b.itemSum).toBe(70_253_448)
    expect(b.grandTotal).toBe(70_253_448)
    expect(b.skipped).toHaveLength(0)
  })
  it('prose section gets its code from its first coded sub-skill', () => {
    const cw = b.disciplines.find(d => d.name === 'Compound Wall')!
    expect(cw.code).toBe('16')
    expect(cw.subSkills[0].code).toBe('1605')
    expect(cw.categoryTotal).toBe(17_652_800)
    expect(cw.reconDelta).toBe(0)
  })
  it('fully-uncoded section keeps code null, captures subs + remarks', () => {
    const rw = b.disciplines.find(d => d.name === 'Retaining Walls & Gabion Walls')!
    expect(rw.code).toBeNull()
    expect(rw.subSkills).toHaveLength(4)
    expect(rw.subSkills.every(s => s.code === null)).toBe(true)
    expect(rw.reconDelta).toBe(0) // 3.54Cr + 80L + 76.8L + 15.4L = cat total
    const c = rw.subSkills.find(s => s.name === 'RCC Retaining Walls - C')!
    expect(c.amount).toBe(35_382_560)
    expect(c.remark).toBe('Billed under Building RW')
  })
  it('remark captured on coded rows too', () => {
    const cw = b.disciplines.find(d => d.name === 'Compound Wall')!
    expect(cw.subSkills[0].remark).toBe('800m - WC to DN Anx')
  })
})

describe('edges', () => {
  it('empty workbook / missing header fail gracefully with a reason', () => {
    expect(parseInternalBudget([]).parseOk).toBe(false)
    const noHeader = parseInternalBudget([{ name: 'X', aoa: [['random'], ['rows']] }])
    expect(noHeader.parseOk).toBe(false)
    expect(noHeader.failReason).toMatch(/header/i)
  })
  it('all-zero money columns flag the file instead of inventing numbers', () => {
    const grid = consultantsOnlyGrid().map(r => [...r])
    // zero out the consultants columns on sub-skill rows + footer
    for (const r of grid) { r[8] = null; r[9] = null }
    const b = parseInternalBudget([{ name: 'Z', aoa: grid }])
    expect(b.parseOk).toBe(false)
    expect(b.failReason).toMatch(/zero|empty/i)
  })
  it('tabCodeMap maps multi-code tab names to every code', () => {
    const map = tabCodeMap([
      { name: 'main', aoa: [] },
      { name: '1204 1205 Flooring & dado', aoa: [] },
      { name: '310 Window Sill', aoa: [] },
    ])
    expect(map.get('1204')).toBe('1204 1205 Flooring & dado')
    expect(map.get('1205')).toBe('1204 1205 Flooring & dado')
    expect(map.get('310')).toBe('310 Window Sill')
  })
})
