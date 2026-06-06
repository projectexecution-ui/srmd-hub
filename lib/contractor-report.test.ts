import { describe, it, expect } from 'vitest'
import {
  parseCertificatesSheet, aggregate, groupBySubproject, buildReport,
  sanityCheck, findHeaderRow, type Sheet,
} from './contractor-report'

// ============================================================================
// SCENARIO MATRIX — IN4 "All Types Certificates Details" → Category×Contractor.
// Pure logic, so we build synthetic sheets (array-of-arrays, as SheetJS's
// sheet_to_json(header:1) returns) that mirror the real export's quirks:
// title rows, header at row 3, "Subproject:" markers, repeated WO bill rows,
// Total/Company filler rows, and a source "Project Total :" row.
// Grouped: valid / invalid / edge / extreme.
// ============================================================================

const HEADER = [
  'Work Category', 'Sub Category', 'Work Order Number', 'Contractor Name',
  'Work Order Value', 'Gross Bill Amount', 'Amount Paid', 'Outstanding Amount',
]

// Build a "Project Total :" row: col 12 marker, bill@20, paid@31, balance@32.
function projectTotalRow(bill: number, paid: number, balance: number): (string | number | null)[] {
  const row: (string | number | null)[] = new Array(33).fill(null)
  row[12] = 'Project Total :'
  row[20] = bill
  row[31] = paid
  row[32] = balance
  return row
}

// A representative sheet: 2 subprojects, a WO with two bill rows (dedup test),
// a Total filler row (must be dropped), and a matching source-total row.
function sampleSheet(): Sheet {
  return [
    ['All Types Certificates Details'],            // 0 title
    ['SRMD Construction'],                          // 1
    [],                                             // 2
    HEADER,                                         // 3 header
    ['Project: New Guest House, Subproject: Block A'], // 4 marker
    ['Civil', 'Footing', 'WO-1', 'ABC Const', 100000, 30000, 20000, 10000], // 5
    ['Civil', 'Footing', 'WO-1', 'ABC Const', 100000, 20000, 10000, 10000], // 6 same WO, 2nd bill
    ['Civil', 'Plaster', 'WO-2', 'ABC Const', 50000, 50000, 50000, 0],      // 7
    ['Electrical', 'Wiring', 'WO-3', 'XYZ Elec', 80000, 80000, 40000, 40000], // 8
    ['Total', null, null, null, null, 999, 999, 999],                        // 9 dropped
    ['Project: New Guest House, Subproject: Block B'], // 10 marker
    ['Civil', 'Footing', 'WO-4', 'ABC Const', 60000, 60000, 30000, 30000],  // 11
    projectTotalRow(240000, 150000, 90000),         // 12 source totals
  ]
}

describe('findHeaderRow', () => {
  it('valid: returns 3 for the standard IN4 layout', () => {
    expect(findHeaderRow(sampleSheet())).toBe(3)
  })
  it('edge: locates a shifted header row instead of silently failing', () => {
    const shifted: Sheet = [[], [], [], [], [], HEADER, ['Civil', 'x', 'WO-9', 'ABC', 1, 1, 1, 0]]
    expect(findHeaderRow(shifted)).toBe(5)
  })
})

describe('parseCertificatesSheet', () => {
  describe('valid', () => {
    it('extracts data rows, tags subprojects, captures project name', () => {
      const { projectName, rows, sourceTotals } = parseCertificatesSheet(sampleSheet())
      expect(projectName).toBe('New Guest House')
      expect(rows).toHaveLength(5) // 4 in Block A (incl. the 2 WO-1 bill rows) + 1 in Block B
      expect(rows[0]).toMatchObject({ workCategory: 'Civil', contractor: 'ABC Const', subproject: 'Block A', bill: 30000 })
      expect(rows[4]).toMatchObject({ subproject: 'Block B', woNumber: 'WO-4' })
      expect(sourceTotals).toEqual({ bill: 240000, paid: 150000, balance: 90000 })
    })
  })

  describe('invalid / filler rows', () => {
    it('drops Total rows, Company: banners, and rows missing category/contractor', () => {
      const sheet: Sheet = [
        [], [], [], HEADER,
        ['Project: P, Subproject: S'],
        ['Total', null, null, null, null, 1, 1, 1],            // dropped (Total)
        ['Company: SRMD', null, null, null, null, null, null, null], // dropped (Company:)
        ['Civil', 'x', 'WO-1', null, 10, 10, 10, 0],           // dropped (no contractor)
        [null, 'x', 'WO-2', 'ABC', 10, 10, 10, 0],             // dropped (no category)
        ['Civil', 'x', 'WO-3', 'ABC', 100, 90, 80, 10],        // kept
      ]
      const { rows } = parseCertificatesSheet(sheet)
      expect(rows).toHaveLength(1)
      expect(rows[0].woNumber).toBe('WO-3')
    })
  })

  describe('edge', () => {
    it('rows before any Subproject marker get "(Unknown Subproject)"', () => {
      const sheet: Sheet = [
        [], [], [], HEADER,
        ['Civil', 'x', 'WO-1', 'ABC', 100, 90, 80, 10], // no marker seen yet
      ]
      expect(parseCertificatesSheet(sheet).rows[0].subproject).toBe('(Unknown Subproject)')
    })
    it('no source total row → sourceTotals null', () => {
      const sheet: Sheet = [[], [], [], HEADER, ['Project: P, Subproject: S'], ['Civil', 'x', 'WO', 'ABC', 1, 1, 1, 0]]
      expect(parseCertificatesSheet(sheet).sourceTotals).toBeNull()
    })
  })

  describe('extreme', () => {
    it('empty sheet → no rows, default project name, no crash', () => {
      const r = parseCertificatesSheet([])
      expect(r.rows).toHaveLength(0)
      expect(r.projectName).toBe('Project Execution Expenses')
      expect(r.sourceTotals).toBeNull()
    })
    it('currency-formatted strings ("₹1,00,000.00") are coerced to numbers', () => {
      const sheet: Sheet = [
        [], [], [], HEADER,
        ['Project: P, Subproject: S'],
        ['Civil', 'x', 'WO-1', 'ABC', '₹1,00,000.00', '30,000', '20,000', '10,000'],
      ]
      expect(parseCertificatesSheet(sheet).rows[0]).toMatchObject({ woValue: 100000, bill: 30000, paid: 20000, balance: 10000 })
    })
  })
})

describe('aggregate — WO-value dedup is the critical correctness point', () => {
  it('valid: sums WO value ONCE per work order, but Bill/Paid/Balance over all rows', () => {
    const { rows } = parseCertificatesSheet(sampleSheet())
    const agg = aggregate(rows)
    const civilAbc = agg.find(a => a.workCategory === 'Civil' && a.contractor === 'ABC Const')!
    // WO-1 (100k, counted once despite 2 bill rows) + WO-2 (50k) + WO-4 (60k) = 210k
    expect(civilAbc.woValue).toBe(210000)
    // Bill summed over all 4 ABC rows: 30k+20k+50k+60k
    expect(civilAbc.bill).toBe(160000)
    expect(civilAbc.paid).toBe(110000)   // 20k+10k+50k+30k
    expect(civilAbc.balance).toBe(50000) // 10k+10k+0+30k

    const elec = agg.find(a => a.workCategory === 'Electrical')!
    expect(elec).toMatchObject({ contractor: 'XYZ Elec', woValue: 80000, bill: 80000, paid: 40000, balance: 40000 })
  })

  it('edge: sorted by (category, contractor)', () => {
    const rows = parseCertificatesSheet(sampleSheet()).rows
    const agg = aggregate(rows)
    expect(agg.map(a => a.workCategory)).toEqual(['Civil', 'Electrical'])
  })

  it('edge: empty input → empty aggregate', () => {
    expect(aggregate([])).toEqual([])
  })
})

describe('groupBySubproject + buildReport', () => {
  it('valid: splits into one section per subproject, sorted', () => {
    const rows = parseCertificatesSheet(sampleSheet()).rows
    const groups = groupBySubproject(rows)
    expect([...groups.keys()]).toEqual(['Block A', 'Block B'])

    const sections = buildReport(rows, false)
    expect(sections.map(s => s.name)).toEqual(['Block A', 'Block B'])
    const blockA = sections[0]
    // Block A grand total bill = 30k+20k+50k (ABC) + 80k (XYZ) = 180k
    expect(blockA.grandTotal.bill).toBe(180000)
    // Two categories in Block A
    expect(blockA.categories.map(c => c.category)).toEqual(['Civil', 'Electrical'])
  })

  it('valid: combined mode produces a single "All Subprojects" section', () => {
    const rows = parseCertificatesSheet(sampleSheet()).rows
    const sections = buildReport(rows, true)
    expect(sections).toHaveLength(1)
    expect(sections[0].name).toBe('All Subprojects')
    expect(sections[0].grandTotal.bill).toBe(240000) // 160k ABC + 80k XYZ
  })

  it('edge: category subtotal equals the sum of its contractors', () => {
    const rows = parseCertificatesSheet(sampleSheet()).rows
    const [combined] = buildReport(rows, true)
    const civil = combined.categories.find(c => c.category === 'Civil')!
    expect(civil.subtotal.bill).toBe(civil.contractors.reduce((s, c) => s + c.bill, 0))
  })
})

describe('sanityCheck', () => {
  it('valid: computed grand totals MATCH the source Project Total row', () => {
    const { rows, sourceTotals } = parseCertificatesSheet(sampleSheet())
    const sections = buildReport(rows, true)
    const res = sanityCheck(sections, sourceTotals)
    expect(res.match).toBe(true)
    expect(res.computed).toMatchObject({ bill: 240000, paid: 150000, balance: 90000 })
  })

  it('invalid: a wrong source total is flagged as MISMATCH with diffs', () => {
    const { rows } = parseCertificatesSheet(sampleSheet())
    const sections = buildReport(rows, true)
    const res = sanityCheck(sections, { bill: 999999, paid: 150000, balance: 90000 })
    expect(res.match).toBe(false)
    expect(res.diff!.bill).toBe(759999)
  })

  it('edge: within ₹1 tolerance still matches (float rounding)', () => {
    const { rows } = parseCertificatesSheet(sampleSheet())
    const sections = buildReport(rows, true)
    const res = sanityCheck(sections, { bill: 240000.4, paid: 150000, balance: 90000 })
    expect(res.match).toBe(true)
  })

  it('edge: no source row → match=true (nothing to contradict), diff null', () => {
    const sections = buildReport(parseCertificatesSheet(sampleSheet()).rows, true)
    const res = sanityCheck(sections, null)
    expect(res.match).toBe(true)
    expect(res.diff).toBeNull()
  })
})
