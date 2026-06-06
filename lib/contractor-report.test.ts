import { describe, it, expect } from 'vitest'
import {
  parseSourceReport, deriveContractor, sumContractors, categorySubtotal,
  subprojectTotal, reportGrandTotal, combineSubprojects, displayCategory,
  reconcile, type Sheet,
} from './contractor-report'

// ============================================================================
// SCENARIO MATRIX — raw IN4 export → Sub-project → Category → Contractor.
// Source cols (header row 3): 0 Category · 2 WO# · 4 Contractor · 5 WO Value ·
// 20 Gross Bill · 21 Advance Recovered · 25 Tax Deduction · 26 Retention ·
// 27 Other Deduction · 31 Amount Paid · 32 Outstanding.  Grouped per
// sub-project (from the "Subproject:" marker); Combined view merges them.
// Grouped: valid / invalid / edge / extreme.
// ============================================================================

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

// Two sub-projects, both with a " 03 Civil"/ABC row (so split keeps them
// separate and Combined merges them), plus a Project Total row to reconcile.
function sampleSheet(): Sheet {
  return [
    [null, null, null, 'SRMD'], [null, null, null, 'All Types Certificates'], ['From …'], HEADER, [null],
    marker('Vinay Vivek', 'Sub A'),
    row({ 0: ' 03 Civil', 2: 'WO-1', 4: 'ABC', 5: 1000, 20: 500, 31: 480, 25: 20, 32: 0 }),
    row({ 0: ' 03 Civil', 2: 'WO-1', 4: 'ABC', 5: 1000, 20: 300, 31: 300, 25: 0, 32: 0 }), // same WO
    row({ 0: ' 03 Civil', 2: 'WO-2', 4: 'ABC', 5: 2000, 20: 200, 31: 180, 25: 20, 32: 0 }),
    row({ 0: ' 19 Site Admin', 2: 'WO-3', 4: 'XYZ', 5: 800, 20: 800, 21: 100, 31: 600, 26: 50, 32: 50 }),
    marker('Vinay Vivek', 'Sub B'),
    row({ 0: ' 03 Civil', 2: 'WO-4', 4: 'ABC', 5: 5000, 20: 1000, 31: 900, 25: 50, 32: 50 }),
    // computed: gross 2800, adv 100, paid 2460, taxded 90, ret 50, out 100
    row({ 12: 'Project Total :', 20: 2800, 21: 100, 25: 90, 26: 50, 27: 0, 31: 2460, 32: 100 }),
  ]
}

describe('parseSourceReport — sub-project grouping', () => {
  describe('valid', () => {
    it('splits into sub-projects in encounter order', () => {
      const { subprojects, projectName } = parseSourceReport(sampleSheet())
      expect(projectName).toBe('Vinay Vivek')
      expect(subprojects.map(s => s.name)).toEqual(['Sub A', 'Sub B'])
    })

    it('aggregates per (sub-project, category, contractor) with WO dedup + advance netting', () => {
      const { subprojects } = parseSourceReport(sampleSheet())
      const subA = subprojects[0]
      const abc = subA.categories.find(c => c.category.trim() === '03 Civil')!.contractors[0]
      expect(abc).toMatchObject({ contractor: 'ABC', woValue: 3000, billValue: 1000, paidValue: 960, deductions: 40 })
      const xyz = subA.categories.find(c => c.category.trim() === '19 Site Admin')!.contractors[0]
      expect(xyz.billValue).toBe(700)   // 800 gross − 100 advance
      expect(deriveContractor(xyz).totalOwed).toBe(100) // balance 50 + retention 50
      // Sub B has the SAME category+contractor, kept separate here
      expect(subprojects[1].categories[0].contractors[0]).toMatchObject({ contractor: 'ABC', billValue: 1000 })
    })
  })

  describe('edge', () => {
    it('rows before any marker land in "(Unknown Sub-project)"', () => {
      const sheet: Sheet = [[], [], [], HEADER, [], row({ 0: ' 03 Civil', 2: 'WO-1', 4: 'ABC', 5: 1, 20: 1, 31: 1 })]
      expect(parseSourceReport(sheet).subprojects[0].name).toBe('(Unknown Sub-project)')
    })
    it('empty sheet → no sub-projects, no crash', () => {
      expect(parseSourceReport([]).subprojects).toHaveLength(0)
    })
  })

  describe('invalid', () => {
    it('skips markers, Project Total, and blank rows (no phantom contractors)', () => {
      const { subprojects } = parseSourceReport(sampleSheet())
      const names = subprojects.flatMap(s => s.categories.flatMap(c => c.contractors.map(x => x.contractor)))
      // Sub A: Civil/ABC (WO-1+WO-2 → one row), Admin/XYZ · Sub B: Civil/ABC
      expect(names).toEqual(['ABC', 'XYZ', 'ABC'])
    })
  })
})

describe('combineSubprojects — the "Combined" (clubbed) view', () => {
  it('valid: merges the same (category, contractor) across sub-projects', () => {
    const { subprojects } = parseSourceReport(sampleSheet())
    const combined = combineSubprojects(subprojects)
    const civil = combined.find(c => c.category.trim() === '03 Civil')!
    const abc = civil.contractors.find(c => c.contractor === 'ABC')!
    expect(abc.woValue).toBe(8000)    // Sub A 3000 + Sub B 5000
    expect(abc.billValue).toBe(2000)  // 1000 + 1000
    expect(abc.paidValue).toBe(1860)  // 960 + 900
    expect(combined.map(c => c.category.trim())).toEqual(['03 Civil', '19 Site Admin'])
  })
})

describe('totals', () => {
  it('valid: sub-project total sums its categories', () => {
    const { subprojects } = parseSourceReport(sampleSheet())
    expect(subprojectTotal(subprojects[0]).billValue).toBe(1700) // ABC 1000 + XYZ 700
  })
  it('valid: report grand total spans all sub-projects', () => {
    const { subprojects } = parseSourceReport(sampleSheet())
    const gt = reportGrandTotal(subprojects)
    expect(gt.billValue).toBe(2700)   // 1000 + 700 + 1000
    expect(gt.paidValue).toBe(2460)
    expect(gt.totalOwed).toBe(150)    // 0 + 100 + 50
  })
  it('edge: category subtotal + display label', () => {
    const { subprojects } = parseSourceReport(sampleSheet())
    expect(categorySubtotal(subprojects[0].categories[0]).billValue).toBe(1000)
    expect(displayCategory(' 03 Civil')).toBe('03 Civil')
  })
})

describe('deriveContractor', () => {
  it('Balance = Bill−Paid−Ded−Ret; Total Owed = Balance+Ret', () => {
    const c = deriveContractor({ contractor: 'X', woValue: 0, billValue: 1000, paidValue: 600, deductions: 100, retentionHeld: 50, outstanding: 0 })
    expect(c.balanceValue).toBe(250)
    expect(c.totalOwed).toBe(300)
  })
  it('empty → zero totals', () => {
    expect(sumContractors([]).billValue).toBe(0)
  })
})

describe('reconcile against IN4 Project Total', () => {
  it('valid: every raw column ties to the Project Total row → allOk', () => {
    const { computed, source } = parseSourceReport(sampleSheet())
    const rec = reconcile(computed, source)
    expect(rec.available).toBe(true)
    expect(rec.allOk).toBe(true)
  })
  it('invalid: a wrong source total surfaces a non-zero delta', () => {
    const { computed } = parseSourceReport(sampleSheet())
    const rec = reconcile(computed, { grossBill: 9999, recoveries: 0, paid: 2460, deductions: 90, retention: 50, outstanding: 100 })
    expect(rec.allOk).toBe(false)
    expect(rec.lines.find(l => l.label === 'Gross Bill')!.ok).toBe(false)
  })
  it('edge: no Project Total row → unavailable, not an error', () => {
    const rec = reconcile({ grossBill: 1, recoveries: 0, paid: 1, deductions: 0, retention: 0, outstanding: 0 }, null)
    expect(rec.available).toBe(false)
  })
})
