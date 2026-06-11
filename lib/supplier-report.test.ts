import { describe, it, expect } from 'vitest'
import {
  parseSourceReport, parseSourceReports, sumSuppliers, categorySubtotal,
  subprojectTotal, reportGrandTotal, combineSubprojects, displayCategory,
  reconcile, costOf, type Sheet,
} from './supplier-report'

// ============================================================================
// SCENARIO MATRIX — raw IN4 "All Purchase Payments Report" → Project →
// Sub-project → Material Category → Supplier. Source cols (header row 3):
//   0 PO No · 2 Cert Type · 8 Vendor (supplier) · 10 Material/Asset (category)
//   17 Tax Deductions · 22 Total Cost (Bill) · 23 Adv Recovered · 24 Debit Note
//   25 Retention · 26 Net Payable · 28 Paid · 29 Outstanding
// Markers are 3 col-3 rows: COMPANY / PROJECT / SUBPROJECT. Each sub-project
// block ends with a "Total(s) :" row (col 11) whose col 22 = Total Cost.
// ============================================================================

function row(map: Record<number, string | number | null>): (string | number | null)[] {
  const a: (string | number | null)[] = new Array(30).fill(null)
  for (const k of Object.keys(map)) a[Number(k)] = map[Number(k)]
  return a
}
const HEADER = row({
  0: 'PO. No.', 2: 'Certificate Type', 8: 'Vendor Name', 10: 'Material/Asset Type',
  17: 'Tax Deductions', 22: 'Total Cost\n(G=D+E-F)', 23: 'Adv Recovered\n(H)',
  24: 'Debit Note Recovered\n(I)', 25: 'Retention\nAmount(J)', 26: 'Net. Payable Amt\n(K)',
  28: 'Paid Amt\n(L)', 29: 'Outstanding Amt\n(K-L)',
})
const projMarker = (p: string) => row({ 3: `PROJECT NAME    :    ${p}` })
const subMarker = (s: string) => row({ 3: `SUBPROJECT NAME    :    ${s}` })
const totalRow = (totalCost: number) => row({ 11: 'Total(s) :', 22: totalCost })

// supplier cert row helper
function cert(po: string, vendor: string, cat: string, vals: Partial<{
  bill: number; adv: number; dn: number; tax: number; ret: number; net: number; paid: number; out: number
}>) {
  return row({
    0: po, 2: 'Regular Supplier Certificate', 8: vendor, 10: cat,
    17: vals.tax ?? 0, 22: vals.bill ?? 0, 23: vals.adv ?? 0, 24: vals.dn ?? 0,
    25: vals.ret ?? 0, 26: vals.net ?? 0, 28: vals.paid ?? 0, 29: vals.out ?? 0,
  })
}

// One project, two sub-projects. Sub A has two suppliers across two
// categories; the same supplier ALPHA appears in Sub B too (so Combined
// merges it). Each sub-project ends with its own Total(s) row.
function sampleSheet(): Sheet {
  return [
    [null, 'SRET'], [null, 'ALL PURCHASE PAYMENTS REPORT'], ['Date From: To Date:'], HEADER,
    row({ 3: 'COMPANY NAME    :    SRASSK' }),
    projMarker('Admin Block'),
    subMarker('Admin Block - Execution'),
    cert('PO-1', 'ALPHA', '03 (M) Civil', { bill: 1000, paid: 800, net: 1000, out: 200 }),
    cert('PO-1', 'ALPHA', '03 (M) Civil', { bill: 500, paid: 500, net: 500, out: 0 }), // same supplier+cat, sums
    cert('PO-2', 'BETA', '07 (M) Electrical Works', { bill: 800, adv: 100, ret: 50, net: 650, paid: 600, out: 50 }),
    totalRow(2300), // 1000+500+800
    projMarker('Admin Block'),
    subMarker('Admin Block - Refurbish'),
    cert('PO-3', 'ALPHA', '03 (M) Civil', { bill: 2000, paid: 1500, net: 2000, out: 500 }),
    totalRow(2000),
  ]
}

describe('parseSourceReport — project + sub-project grouping', () => {
  it('keeps the project name and splits into sub-projects in encounter order', () => {
    const { projectName, subprojects } = parseSourceReport(sampleSheet())
    expect(projectName).toBe('Admin Block')
    expect(subprojects.map(s => s.name)).toEqual(['Admin Block - Execution', 'Admin Block - Refurbish'])
  })

  it('aggregates per (sub-project, category, supplier) and sums duplicate rows', () => {
    const { subprojects } = parseSourceReport(sampleSheet())
    const subA = subprojects[0]
    const alpha = subA.categories.find(c => c.category.includes('Civil'))!.suppliers[0]
    expect(alpha).toMatchObject({ supplier: 'ALPHA', billValue: 1500, paidValue: 1300, outstanding: 200 })
    const beta = subA.categories.find(c => c.category.includes('Electrical'))!.suppliers[0]
    expect(beta).toMatchObject({ supplier: 'BETA', billValue: 800, recoveries: 100, retentionHeld: 50, netPayable: 650 })
  })

  it('reconciles computed Total Cost against the IN4 Total(s) rows', () => {
    const { computedBill, source } = parseSourceReport(sampleSheet())
    expect(computedBill).toBe(4300) // 2300 + 2000
    expect(source).toEqual({ billValue: 4300 })
    const rec = reconcile(computedBill, source)
    expect(rec.available).toBe(true)
    expect(rec.allOk).toBe(true)
  })
})

describe('totals + combine', () => {
  it('reportGrandTotal sums every supplier across sub-projects', () => {
    const { subprojects } = parseSourceReport(sampleSheet())
    const gt = reportGrandTotal(subprojects)
    expect(gt.billValue).toBe(4300)
    expect(gt.paidValue).toBe(3400)   // 800+500+600+1500
    expect(gt.outstanding).toBe(750)  // 200+0+50+500
  })

  it('combineSubprojects merges the same (category, supplier) across sub-projects', () => {
    const { subprojects } = parseSourceReport(sampleSheet())
    const combined = combineSubprojects(subprojects)
    const civil = combined.find(c => c.category.includes('Civil'))!
    // ALPHA appears in both sub-projects → merged into one row
    expect(civil.suppliers).toHaveLength(1)
    expect(civil.suppliers[0]).toMatchObject({ supplier: 'ALPHA', billValue: 3500, paidValue: 2800, outstanding: 700 })
  })

  it('categorySubtotal + subprojectTotal add up', () => {
    const { subprojects } = parseSourceReport(sampleSheet())
    expect(subprojectTotal(subprojects[0]).billValue).toBe(2300)
    const civilCat = subprojects[0].categories.find(c => c.category.includes('Civil'))!
    expect(categorySubtotal(civilCat).billValue).toBe(1500)
  })

  it('costOf switches the metric base', () => {
    const t = { billValue: 1000, netPayable: 900, paidValue: 700 }
    expect(costOf(t, 'bill')).toBe(1000)
    expect(costOf(t, 'net')).toBe(900)
    expect(costOf(t, 'paid')).toBe(700)
  })
})

describe('multi-project + edge cases', () => {
  it('splits a company-wide export into one report per project', () => {
    const sheet: Sheet = [
      HEADER,
      projMarker('Project One'), subMarker('P1 - Exec'),
      cert('PO-A', 'ALPHA', '03 (M) Civil', { bill: 100, paid: 100, net: 100 }),
      totalRow(100),
      projMarker('Project Two'), subMarker('P2 - Exec'),
      cert('PO-B', 'GAMMA', '12 (M) Finishes', { bill: 250, paid: 0, net: 250, out: 250 }),
      totalRow(250),
    ]
    const reports = parseSourceReports(sheet)
    expect(reports.map(r => r.projectName)).toEqual(['Project One', 'Project Two'])
    expect(reportGrandTotal(reports[1].subprojects).outstanding).toBe(250)
  })

  it('uses a placeholder category when Material/Asset Type is blank', () => {
    const sheet: Sheet = [
      HEADER, projMarker('P'), subMarker('S'),
      cert('PO-X', 'ALPHA', '', { bill: 100, paid: 100, net: 100 }),
      totalRow(100),
    ]
    const { subprojects } = parseSourceReport(sheet)
    expect(displayCategory(subprojects[0].categories[0].category)).toBe('(Uncategorised)')
  })

  it('reports no reconciliation when there is no Total(s) row', () => {
    const sheet: Sheet = [
      HEADER, projMarker('P'), subMarker('S'),
      cert('PO-X', 'ALPHA', '03 (M) Civil', { bill: 100, paid: 100, net: 100 }),
    ]
    const { source } = parseSourceReport(sheet)
    expect(source).toBeNull()
    expect(reconcile(100, source).available).toBe(false)
  })

  it('returns an empty shell for a sheet with no supplier rows', () => {
    const { subprojects, projectName } = parseSourceReport([HEADER])
    expect(projectName).toBe('Project')
    expect(subprojects).toEqual([])
  })
})
