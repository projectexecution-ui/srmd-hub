import { describe, it, expect } from 'vitest'
import {
  parseSourceReport, deriveContractor, sumContractors, categorySubtotal,
  grandTotal, displayCategory, reconcile, type Sheet,
} from './contractor-report'

// ============================================================================
// SCENARIO MATRIX — raw IN4 "All Types Certificates Details" → 9-col report.
// The module ingests the RAW export and aggregates Category × Contractor.
// Source col map (header row 3): 0 Category · 2 WO# · 4 Contractor ·
// 5 WO Value · 20 Gross Bill · 21 Advance Recovered · 25 Tax Deduction ·
// 26 Retention · 27 Other Deduction · 31 Amount Paid · 32 Outstanding.
// Derived: Bill = Gross − recoveries; Deductions = Tax+Other; Balance =
// Bill−Paid−Ded−Ret; Total Owed = Balance+Ret. Grouped valid/invalid/edge/extreme.
// ============================================================================

// Build a 33-wide source row from {colIndex: value}.
function row(map: Record<number, string | number | null>): (string | number | null)[] {
  const a: (string | number | null)[] = new Array(33).fill(null)
  for (const k of Object.keys(map)) a[Number(k)] = map[Number(k)]
  return a
}
const HEADER = row({
  0: 'Work Category', 1: 'Sub Category', 2: 'Work Order Number', 4: 'Contractor Name',
  5: 'Work Order Value', 20: 'Gross Bill Amount', 21: 'Advance Adj. Recovered',
  25: 'Tax Deduction', 26: 'Retention Amount', 27: 'Other Deduction',
  31: 'Amount Paid', 32: 'Outstanding Amount',
})
const marker = (proj: string, sub: string) =>
  row({ 0: `Company: SRASSK , State: GJ , Location: Valsad , Project: ${proj} , Subproject: ${sub}` })

// A representative source: one subproject, a WO billed twice (WO-value dedup),
// a second WO, plus an exact IN4 "Project Total :" row to reconcile against.
function sampleSheet(): Sheet {
  return [
    [null, null, null, 'Shrimad Rajchandra'],            // 0 title
    [null, null, null, 'All Types Certificates Details Report'], // 1
    ['From Date …'],                                      // 2
    HEADER,                                               // 3 header
    [null],                                               // 4 sub-header
    marker('Vinay Vivek', 'Vinay ST - Execution'),       // 5 subproject
    row({ 0: ' 03 Civil', 2: 'WO-1', 4: 'ABC', 5: 1000, 20: 500, 21: 0, 25: 10, 26: 0, 27: 0, 31: 480, 32: 10 }), // 6
    row({ 0: ' 03 Civil', 2: 'WO-1', 4: 'ABC', 5: 1000, 20: 300, 21: 0, 25: 0, 26: 0, 27: 0, 31: 300, 32: 0 }),   // 7 same WO
    row({ 0: ' 03 Civil', 2: 'WO-2', 4: 'ABC', 5: 2000, 20: 200, 21: 0, 25: 20, 26: 0, 27: 0, 31: 180, 32: 0 }),  // 8
    row({ 0: ' 19 Site Admin', 2: 'WO-3', 4: 'XYZ', 5: 800, 20: 800, 21: 100, 25: 0, 26: 50, 27: 0, 31: 600, 32: 50 }), // 9 (advance 100, retention 50)
    row({ 12: 'SubProject Total  :', 20: 1800, 31: 1560 }), // 10 skipped
    // Project Total: gross 1800, recoveries 100, paid 1560, taxded 30, ret 50, other 0, outstanding 60
    row({ 12: 'Project Total :', 20: 1800, 21: 100, 25: 30, 26: 50, 27: 0, 31: 1560, 32: 60 }), // 11
  ]
}

describe('deriveContractor', () => {
  it('valid: Balance = Bill−Paid−Ded−Ret; Total Owed = Balance+Ret', () => {
    const c = deriveContractor({ contractor: 'X', woValue: 0, billValue: 1000, paidValue: 600, deductions: 100, retentionHeld: 50, outstanding: 0 })
    expect(c.balanceValue).toBe(250)
    expect(c.totalOwed).toBe(300)
  })
  it('edge: retention-only owed when paid in full', () => {
    const c = deriveContractor({ contractor: 'Y', woValue: 0, billValue: 100, paidValue: 95, deductions: 0, retentionHeld: 5, outstanding: 5 })
    expect(c.balanceValue).toBe(0)
    expect(c.totalOwed).toBe(5)
  })
})

describe('parseSourceReport', () => {
  describe('valid', () => {
    it('extracts project name from the subproject marker', () => {
      expect(parseSourceReport(sampleSheet()).projectName).toBe('Vinay Vivek')
    })

    it('aggregates per (category, contractor) with WO-value dedup + advance netting', () => {
      const { categories } = parseSourceReport(sampleSheet())
      const civil = categories.find(c => c.category.trim() === '03 Civil')!
      const abc = civil.contractors.find(c => c.contractor === 'ABC')!
      expect(abc.woValue).toBe(3000)      // WO-1 (1000 once) + WO-2 (2000)
      expect(abc.billValue).toBe(1000)    // (500+300+200) gross, no advances
      expect(abc.paidValue).toBe(960)     // 480+300+180
      expect(abc.deductions).toBe(30)     // (10)+(0)+(20)
      expect(abc.retentionHeld).toBe(0)
      expect(deriveContractor(abc).balanceValue).toBe(10) // 1000-960-30-0
    })

    it('nets advances out of the bill (XYZ: gross 800 − advance 100 = 750)', () => {
      const { categories } = parseSourceReport(sampleSheet())
      const xyz = categories.find(c => c.category.trim() === '19 Site Admin')!.contractors[0]
      expect(xyz.billValue).toBe(700)     // 800 gross − 100 advance
      expect(xyz.retentionHeld).toBe(50)
      expect(deriveContractor(xyz).balanceValue).toBe(50)   // 700-600-0-50
      expect(deriveContractor(xyz).totalOwed).toBe(100)     // 50 + 50 retention
    })
  })

  describe('invalid / structural rows', () => {
    it('skips Subproject markers, SubProject Total, and Project Total rows', () => {
      const { categories } = parseSourceReport(sampleSheet())
      expect(categories.map(c => c.category.trim())).toEqual(['03 Civil', '19 Site Admin'])
      const allContractors = categories.flatMap(c => c.contractors.map(x => x.contractor))
      expect(allContractors).toEqual(['ABC', 'XYZ'])
    })
  })

  describe('edge', () => {
    it('preserves leading-space category distinction (same name, two subprojects)', () => {
      const sheet: Sheet = [
        [], [], [], HEADER, [], marker('P', 'A'),
        row({ 0: ' 03 Civil', 2: 'WO-1', 4: 'ABC', 5: 1, 20: 1, 31: 1 }),
        row({ 0: '03 Civil', 2: 'WO-2', 4: 'ABC', 5: 1, 20: 1, 31: 1 }),  // no leading space
      ]
      const { categories } = parseSourceReport(sheet)
      expect(categories.map(c => c.category)).toEqual([' 03 Civil', '03 Civil'])
      expect(displayCategory(' 03 Civil')).toBe('03 Civil')
    })
    it('empty sheet → no categories, no crash', () => {
      const r = parseSourceReport([])
      expect(r.categories).toHaveLength(0)
      expect(r.projectName).toBe('Project')
    })
  })

  describe('extreme', () => {
    it('currency-formatted strings coerce', () => {
      const sheet: Sheet = [
        [], [], [], HEADER, [], marker('P', 'A'),
        row({ 0: ' 03 Civil', 2: 'WO-1', 4: 'ABC', 5: '₹3,000', 20: '₹1,000.00', 31: '960', 25: '30' }),
      ]
      const abc = parseSourceReport(sheet).categories[0].contractors[0]
      expect(abc).toMatchObject({ woValue: 3000, billValue: 1000, paidValue: 960, deductions: 30 })
    })
  })
})

describe('subtotals & grand total', () => {
  it('valid: grand total spans every contractor', () => {
    const { categories } = parseSourceReport(sampleSheet())
    const gt = grandTotal(categories)
    expect(gt.billValue).toBe(1700)   // ABC 1000 + XYZ 700
    expect(gt.paidValue).toBe(1560)   // 960 + 600
    expect(gt.balanceValue).toBe(60)  // 10 + 50
  })
  it('edge: category subtotal sums its contractors', () => {
    const { categories } = parseSourceReport(sampleSheet())
    expect(categorySubtotal(categories[0]).billValue).toBe(1000)
  })
  it('edge: empty → zero totals', () => {
    expect(sumContractors([]).billValue).toBe(0)
  })
})

describe('reconcile against IN4 Project Total', () => {
  it('valid: every raw column ties to the Project Total row → allOk', () => {
    const { computed, source } = parseSourceReport(sampleSheet())
    const rec = reconcile(computed, source)
    expect(rec.available).toBe(true)
    expect(rec.allOk).toBe(true)
    // sanity on a couple of lines
    expect(rec.lines.find(l => l.label === 'Amount Paid')!.computed).toBe(1560)
    expect(rec.lines.find(l => l.label.startsWith('Deductions'))!.delta).toBe(0)
  })

  it('invalid: a wrong source total surfaces a non-zero delta (not allOk)', () => {
    const { computed } = parseSourceReport(sampleSheet())
    const rec = reconcile(computed, { grossBill: 9999, recoveries: 0, paid: 1560, deductions: 30, retention: 50, outstanding: 60 })
    expect(rec.allOk).toBe(false)
    expect(rec.lines.find(l => l.label === 'Gross Bill')!.ok).toBe(false)
  })

  it('edge: no Project Total row → reconciliation unavailable (not an error)', () => {
    const rec = reconcile({ grossBill: 1, recoveries: 0, paid: 1, deductions: 0, retention: 0, outstanding: 0 }, null)
    expect(rec.available).toBe(false)
    expect(rec.allOk).toBe(true)
  })
})
