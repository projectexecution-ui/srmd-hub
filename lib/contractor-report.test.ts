import { describe, it, expect } from 'vitest'
import {
  parseGeneratedReport, deriveContractor, sumContractors, categorySubtotal,
  grandTotal, displayCategory, type Sheet, type RawContractor,
} from './contractor-report'

// ============================================================================
// SCENARIO MATRIX — IN4 Contractor Report (generated 9-column format).
// The module ingests the report SRMD's build_report.py produces:
//   A Category · B Contractor · C WO Value · D Bill · E Paid ·
//   F Deductions(hidden) · G Retention(hidden) · H Balance(hidden,=D-E-F-G) ·
//   I Total Owed(=H+G). We store C–G raw and re-derive H, I, subtotals, grand
//   total. Grouped: valid / invalid / edge / extreme.
// ============================================================================

const HEADER = [
  'Category', 'Contractor Name', 'WO Value', 'Total Bill Value', 'Total Paid Value',
  'Deductions', 'Retention Held', 'Balance Value', 'Total Owed',
]

// A sheet shaped like the real export: title, subtitle, blank, header, then
// category blocks (category row, contractor rows, a Subtotal row), a Grand
// Total row, and a Notes footer — all of which we must handle.
function sampleSheet(): Sheet {
  return [
    ['Vinay Vivek — Project Execution Expenses'],
    ['Category-wise & Contractor-wise Summary (All Subprojects, INR)'],
    [],
    HEADER,
    [' 01 Pre Design Works'],
    [null, 'AMIN CARTING', 348808, 348808, 342938, 5870, 0],   // bal = 348808-342938-5870-0 = 0
    [null, 'Accu Tape', 43267.06, 43267.06, 37400, 1467.06, 0], // bal ≈ 4400
    [' 01 Pre Design Works — Subtotal'],
    [],
    [' 02 Earthworks'],
    [null, 'Amin Developers', 580580.54, 580580.54, 551060, -0.46, 24601], // retention 24601
    [' 02 Earthworks — Subtotal'],
    [],
    ['GRAND TOTAL'],
    [],
    ['Notes:'],
    ['• Total Owed (I) = Balance Value (H) + Retention Held (G).'],
    ['• Balance Value (H) = Total Bill − Total Paid − Deductions − Retention Held.'],
  ]
}

describe('deriveContractor — the two formula columns', () => {
  const base: RawContractor = { contractor: 'X', woValue: 1000, billValue: 1000, paidValue: 600, deductions: 100, retentionHeld: 50 }

  describe('valid', () => {
    it('Balance = Bill − Paid − Deductions − Retention; Total Owed = Balance + Retention', () => {
      const c = deriveContractor(base)
      expect(c.balanceValue).toBe(250)   // 1000-600-100-50
      expect(c.totalOwed).toBe(300)      // 250 + 50  (= Bill-Paid-Deductions)
    })
  })

  describe('edge', () => {
    it('a fully-paid contractor nets to zero balance and zero owed', () => {
      const c = deriveContractor({ contractor: 'Y', woValue: 100, billValue: 100, paidValue: 100, deductions: 0, retentionHeld: 0 })
      expect(c.balanceValue).toBe(0)
      expect(c.totalOwed).toBe(0)
    })
    it('retention-only: paid in full but retention withheld → owed equals retention', () => {
      const c = deriveContractor({ contractor: 'Z', woValue: 100, billValue: 100, paidValue: 95, deductions: 0, retentionHeld: 5 })
      expect(c.balanceValue).toBe(0)    // 100-95-0-5
      expect(c.totalOwed).toBe(5)       // still owe the retention
    })
  })

  describe('extreme', () => {
    it('negative rounding noise (Deductions = -0.46) flows through arithmetically', () => {
      const c = deriveContractor({ contractor: 'R', woValue: 580580.54, billValue: 580580.54, paidValue: 551060, deductions: -0.46, retentionHeld: 24601 })
      // 580580.54 - 551060 - (-0.46) - 24601 = 4920.00
      expect(c.balanceValue).toBeCloseTo(4920, 2)
      expect(c.totalOwed).toBeCloseTo(29521, 2)
    })
  })
})

describe('parseGeneratedReport', () => {
  describe('valid', () => {
    it('extracts project name from the title and the category blocks', () => {
      const r = parseGeneratedReport(sampleSheet())
      expect(r.projectName).toBe('Vinay Vivek')
      expect(r.categories.map(c => c.category)).toEqual([' 01 Pre Design Works', ' 02 Earthworks'])
      expect(r.categories[0].contractors).toHaveLength(2)
      expect(r.categories[0].contractors[0]).toMatchObject({ contractor: 'AMIN CARTING', billValue: 348808, deductions: 5870 })
    })
  })

  describe('invalid / structural rows', () => {
    it('skips Subtotal, Grand Total, blank, and Notes rows', () => {
      const r = parseGeneratedReport(sampleSheet())
      // Only real categories survive — no "— Subtotal" / "GRAND TOTAL" / notes
      expect(r.categories).toHaveLength(2)
      const names = r.categories.flatMap(c => c.contractors.map(x => x.contractor))
      expect(names).toEqual(['AMIN CARTING', 'Accu Tape', 'Amin Developers'])
    })
    it('stops at the Notes footer (does not ingest bullet lines as data)', () => {
      const r = parseGeneratedReport(sampleSheet())
      expect(r.categories.some(c => c.category.startsWith('•'))).toBe(false)
    })
  })

  describe('edge', () => {
    it('preserves leading-space category labels distinctly (two subprojects)', () => {
      const sheet: Sheet = [
        ['P — Project Execution Expenses'], ['sub'], [], HEADER,
        [' 01 Civil'], [null, 'A', 1, 1, 1, 0, 0],
        ['01 Civil'], [null, 'B', 2, 2, 2, 0, 0],   // same name, no leading space
      ]
      const r = parseGeneratedReport(sheet)
      expect(r.categories.map(c => c.category)).toEqual([' 01 Civil', '01 Civil'])
      expect(displayCategory(' 01 Civil')).toBe('01 Civil') // display trims
    })
    it('currency-formatted strings are coerced', () => {
      const sheet: Sheet = [
        ['P — Project Execution Expenses'], ['s'], [], HEADER,
        [' 01 Civil'], [null, 'A', '₹3,48,808.00', '3,48,808', '3,42,938', '5,870', '0'],
      ]
      expect(parseGeneratedReport(sheet).categories[0].contractors[0]).toMatchObject({ billValue: 348808, paidValue: 342938, deductions: 5870 })
    })
    it('empty sheet → no categories, default project name, no crash', () => {
      const r = parseGeneratedReport([])
      expect(r.categories).toHaveLength(0)
      expect(r.projectName).toBe('Project')
    })
  })

  describe('extreme', () => {
    it('a category with no contractor rows is dropped', () => {
      const sheet: Sheet = [
        ['P — Project Execution Expenses'], ['s'], [], HEADER,
        [' 01 Empty Category'],
        [' 02 Has Data'], [null, 'A', 1, 1, 1, 0, 0],
      ]
      const r = parseGeneratedReport(sheet)
      expect(r.categories.map(c => c.category)).toEqual([' 02 Has Data'])
    })
  })
})

describe('subtotals & grand total (derived)', () => {
  it('valid: category subtotal sums its contractors across all 7 metrics', () => {
    const r = parseGeneratedReport(sampleSheet())
    const sub = categorySubtotal(r.categories[0]) // AMIN + Accu Tape
    expect(sub.billValue).toBeCloseTo(348808 + 43267.06, 2)
    expect(sub.paidValue).toBeCloseTo(342938 + 37400, 2)
    expect(sub.balanceValue).toBeCloseTo(0 + (43267.06 - 37400 - 1467.06 - 0), 2)
  })

  it('valid: grand total spans every category', () => {
    const r = parseGeneratedReport(sampleSheet())
    const gt = grandTotal(r.categories)
    const billExpected = 348808 + 43267.06 + 580580.54
    expect(gt.billValue).toBeCloseTo(billExpected, 2)
  })

  it('edge: empty input → all-zero totals', () => {
    expect(sumContractors([])).toMatchObject({ billValue: 0, balanceValue: 0, totalOwed: 0 })
  })
})
