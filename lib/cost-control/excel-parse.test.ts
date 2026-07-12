import { describe, it, expect } from 'vitest'
import {
  detectColumns, detectHeader, rankTotalRow, isUnitMetricRow, ladderRoleFor,
  extractRows, pickApprovalFigure, applyLadderCut, extractCategoryHint,
  scanTotalsWithoutHeader, analyzeSheet, analyzeWorkbook, sliceAoaForAi, toNum,
} from './excel-parse'
import {
  MEP_WORKBOOK, MEP_MONEY_SHEET,
  CIVIL_WORKBOOK, CIVIL_MONEY_SHEET,
  SIMPLE_BOQ, SPLIT_COLUMNS,
  NO_HEADER_SHEET, TOTAL_ONLY_SHEET, TWO_ROW_NOT_MERGEABLE,
  FINISHING_RATE_BOQ, QUANTITY_ONLY_SHEET,
} from './excel-parse.fixtures'

// ============================================================================
// SCENARIO MATRIX — the analyzer against REAL working shapes:
//   File A (MEP): multi-sheet + two-row header + approval ladder + tail junk
//   File B (Civil): area trap + RA-payment double-count + group parents
//   plus regressions (today's happy paths) and edges.
// ============================================================================

describe('File A — MEP plumbing BOQ (two-row header + approval ladder)', () => {
  const wb = analyzeWorkbook(MEP_WORKBOOK)
  const money = wb.sheets[0]

  it('detects the TWO-ROW header (SR.NO/ACTIVITY/UNIT/QTY + RATE/TOTAL AMOUNT)', () => {
    expect(money.headerRowIdx).toBe(5)
    expect(money.headerSpansTwoRows).toBe(true)
    const kinds = new Set(money.columns.map(c => c.kind))
    expect(kinds.has('description')).toBe(true) // "ACTIVITY" — regex addition
    expect(kinds.has('rate')).toBe(true)
    expect(kinds.has('amount')).toBe(true)
  })

  it('picks the APPROVAL row as the grand total (rank 3, bottom-most)', () => {
    expect(money.grandTotal).toBe(1_792_000)
    expect(money.totalSource).toBe('approval')
    expect(money.approvalFigure?.sourceRowText).toBe('APPROVAL FOR TOTAL AMOUNT TO ENTER IN ERP SYSTEM')
    expect(money.approvalFigure?.rank).toBe(3)
  })

  it('extracts the A.1–A.6 items (zero-amount lump-sum rows kept, counted)', () => {
    expect(money.itemCount).toBe(6) // A.1 (17.92L) + five ₹0 lump-sum rows
    const a1 = money.rows.find(r => r.raw_label === 'A.1')
    expect(a1).toMatchObject({ qty: 64, rate: 28000, amount: 1_792_000 })
  })

  it('keeps scope-note rows (null amounts) but excludes them from itemCount', () => {
    const scope = money.rows.filter(r => (r.description ?? '').includes('INTERNAL WATER SUPPLY'))
    expect(scope).toHaveLength(1)
    expect(scope[0].amount).toBeNull()
  })

  it('drops GST "NA" (no amount) and keeps MISCELLANEOUS as an addon', () => {
    expect(money.rows.find(r => (r.description ?? '').startsWith('GST@18%'))).toBeUndefined()
    const misc = money.rows.find(r => (r.description ?? '').startsWith('MISCELLANEOUS'))
    expect(misc?.ladder_role).toBe('addon')
    expect(misc?.amount).toBe(0)
  })

  it('cuts the tail: payment terms, time schedule, contact details all gone', () => {
    const texts = money.rows.map(r => `${r.raw_label ?? ''} ${r.description ?? ''}`)
    expect(texts.some(t => /payment/i.test(t))).toBe(false)
    expect(texts.some(t => /SCEHDULE|schedule/i.test(t))).toBe(false)
    expect(texts.some(t => /contact|9702340217/i.test(t))).toBe(false)
  })

  it('extracts the category hint "08 PLUMBING WORKS / sub 805"', () => {
    expect(money.categoryHint).toMatchObject({
      mainCategoryCode: '08',
      mainCategoryName: 'PLUMBING WORKS',
      subCategoryCode: '805',
    })
  })

  it('auto-picks the money sheet over toilet-count and payment-terms sheets', () => {
    expect(wb.bestSheetIndex).toBe(0)
    expect(wb.sheets[1].score).toBeLessThan(money.score)
    expect(wb.sheets[2].score).toBeLessThan(money.score)
  })

  it('sliceAoaForAi cuts below the approval row — no contact details reach the AI', () => {
    const sliced = sliceAoaForAi(money, MEP_MONEY_SHEET)
    expect(sliced.length).toBeLessThanOrEqual(money.approvalFigure!.aoaRowIdx + 3)
    const flat = sliced.flat().map(c => String(c ?? ''))
    expect(flat.some(t => /9702340217/.test(t))).toBe(false)
  })
})

describe('File B — Civil estimate (area trap + RA double-count)', () => {
  const wb = analyzeWorkbook(CIVIL_WORKBOOK)
  const money = wb.sheets[0]

  it('single-row header still detected (pass 1); ESTIMATED QUANTITY binds as qty', () => {
    expect(money.headerRowIdx).toBe(3)
    expect(money.headerSpansTwoRows).toBe(false)
    const qtyCol = money.columns.find(c => c.kind === 'qty')
    expect(qtyCol?.label).toBe('ESTIMATED QUANTITY')
  })

  it('THE 1000x TRAP: grand total is ₹6.44 Cr (Total Estimated Costing), NOT the 64,268 slab area', () => {
    expect(money.grandTotal).toBe(64_425_686.61)
    expect(money.totalSource).toBe('approval')
    expect(money.approvalFigure?.sourceRowText).toBe('Total Estimated Costing')
    const slab = money.totalCandidates.find(c => c.description === 'Total Slab Area')
    expect(slab?.excluded).toBe(true)
  })

  it('"Payment RA01 on Previous WO" is an addon — NOT a double-counted line item', () => {
    const ra = money.rows.find(r => (r.raw_label ?? '').startsWith('Payment RA01'))
    expect(ra).toBeDefined()
    expect(ra!.ladder_role).toBe('addon')
  })

  it('"GST 18%" survives as a tax row', () => {
    const gst = money.rows.find(r => (r.raw_label ?? '').startsWith('GST 18%'))
    expect(gst?.ladder_role).toBe('tax')
    expect(gst?.amount).toBeCloseTo(9_440_632.53, 2)
  })

  it('reconciliation: items + tax + addon ≈ the approval figure', () => {
    const sum = money.rows.reduce((s, r) => {
      const a = r.amount ?? 0
      return r.ladder_role === 'discount' ? s - Math.abs(a) : s + a
    }, 0)
    expect(sum).toBeCloseTo(64_425_686.61, 1)
  })

  it('group parent rows are kept with null amounts; the DESCRIPTION column wins over WORK CATEGORY', () => {
    const steelParent = money.rows.find(r => (r.description ?? '').startsWith('Providing, straightening'))
    expect(steelParent).toBeDefined()
    expect(steelParent!.amount).toBeNull()
  })

  it('rows below the winner are dropped (Cost Per SqFt, NOTE)', () => {
    const texts = money.rows.map(r => `${r.raw_label ?? ''} ${r.description ?? ''}`)
    expect(texts.some(t => /cost per sqft/i.test(t))).toBe(false)
    expect(texts.some(t => /NOTE :-/i.test(t))).toBe(false)
  })

  it('the Area Statement sheet loses the sheet race', () => {
    expect(wb.bestSheetIndex).toBe(0)
    expect(wb.sheets[1].score).toBeLessThan(money.score)
  })
})

describe('File C — consultant finishing BOQ (desc row + money row header)', () => {
  const a = analyzeSheet({ name: 'Finishes', aoa: FINISHING_RATE_BOQ })

  it('merges the Sr/Description row with the Unit/Quantity/Rate/Amount row', () => {
    expect(a.headerRowIdx).toBe(2)
    expect(a.headerSpansTwoRows).toBe(true)
    const kinds = new Set(a.columns.map(c => c.kind))
    expect(kinds.has('description')).toBe(true)
    expect(kinds.has('unit')).toBe(true)
    expect(kinds.has('qty')).toBe(true)
    expect(kinds.has('rate')).toBe(true)
    expect(kinds.has('amount')).toBe(true)
  })

  it('extracts the rate-only items (amount 0, quantities blank)', () => {
    expect(a.itemCount).toBe(3)
    const first = a.rows.find(r => r.raw_label === '1')
    expect(first).toMatchObject({ unit: 'm2', rate: 1495, amount: 0 })
  })
})

describe('File D — quantity-only measurement sheet', () => {
  const a = analyzeSheet({ name: 'NGH B - Flooring & Dedo', aoa: QUANTITY_ONLY_SHEET })

  it('SMT/RMT/Quantity totals are EXCLUDED — no quantity masquerades as money', () => {
    expect(a.totalCandidates.length).toBeGreaterThan(0)
    expect(a.totalCandidates.every(c => c.excluded)).toBe(true)
    expect(a.approvalFigure).toBeNull()
    expect(a.totalSource).not.toBe('approval')
  })
})

describe('regressions — today\'s happy paths unchanged', () => {
  it('SIMPLE_BOQ: 3 items, Grand Total 28,500, source grand_total', () => {
    const a = analyzeSheet({ name: 'BOQ', aoa: SIMPLE_BOQ })
    expect(a.headerRowIdx).toBe(1)
    expect(a.rows).toHaveLength(3)
    expect(a.itemCount).toBe(3)
    expect(a.grandTotal).toBe(28_500)
    expect(a.totalSource).toBe('grand_total')
  })

  it('SPLIT_COLUMNS: total-tagged rate wins, others become breakdown', () => {
    const a = analyzeSheet({ name: 'HVAC', aoa: SPLIT_COLUMNS })
    const duct = a.rows[0]
    expect(duct.rate).toBe(450)
    expect(duct.rate_breakdown).toEqual([
      { label: 'Supply', value: 300 },
      { label: 'Erection', value: 150 },
    ])
    expect(a.grandTotal).toBe(65_000)
    expect(a.totalSource).toBe('total')
  })
})

describe('edges', () => {
  it('no header anywhere → no rows, no total, low score, no throw', () => {
    const a = analyzeSheet({ name: 'Notes', aoa: NO_HEADER_SHEET })
    expect(a.headerRowIdx).toBeNull()
    expect(a.rows).toEqual([])
    expect(a.grandTotal).toBeNull()
    expect(a.totalSource).toBe('none')
  })

  it('all sheets empty → analyzeWorkbook still returns bestSheetIndex 0', () => {
    const wb = analyzeWorkbook([{ name: 'A', aoa: [] }, { name: 'B', aoa: [[null, null]] }])
    expect(wb.bestSheetIndex).toBe(0)
    expect(wb.sheets).toHaveLength(2)
  })

  it('total-only sheet (no items) still yields the figure', () => {
    const a = analyzeSheet({ name: 'Summary', aoa: TOTAL_ONLY_SHEET })
    expect(a.headerRowIdx).toBeNull()
    expect(a.grandTotal).toBe(450_000)
    expect(a.totalSource).toBe('total')
    expect(a.rows).toEqual([])
  })

  it('two-row candidate where row 2 also has a description label is NOT merged', () => {
    expect(detectHeader(TWO_ROW_NOT_MERGEABLE)).toBeNull()
  })

  it('rank interplay: within a rank the LAST wins; rank 3 beats a later rank 2', () => {
    const cands = [
      { aoaRowIdx: 5, description: 'Total', amount: 100, rank: 1 as const, excluded: false, excludeReason: null },
      { aoaRowIdx: 9, description: 'Total', amount: 200, rank: 1 as const, excluded: false, excludeReason: null },
    ]
    expect(pickApprovalFigure(cands)?.amount).toBe(200)

    const withRank3 = [
      { aoaRowIdx: 3, description: 'Total Amount With Tax', amount: 500, rank: 3 as const, excluded: false, excludeReason: null },
      { aoaRowIdx: 8, description: 'Grand Total', amount: 400, rank: 2 as const, excluded: false, excludeReason: null },
    ]
    expect(pickApprovalFigure(withRank3)?.amount).toBe(500)
  })

  it('all candidates excluded → falls back to sum_of_rows', () => {
    const aoa: unknown[][] = [
      ['Sr', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
      [1, 'Painting', 'Sft', 100, 10, 1000],
      ['', 'Total Slab Area', '', null, null, 640],
    ]
    const a = analyzeSheet({ name: 'X', aoa })
    expect(a.grandTotal).toBe(1000)
    expect(a.totalSource).toBe('sum_of_rows')
  })

  it('toNum handles Indian formats and junk', () => {
    expect(toNum(' 1,792,000 ')).toBe(1_792_000)
    expect(toNum('₹1,79,200')).toBe(179_200)
    expect(toNum('NA')).toBeNull()
    expect(toNum('')).toBeNull()
    expect(toNum(42)).toBe(42)
  })

  it('isUnitMetricRow fires on areas and per-sqft, not on money totals', () => {
    expect(isUnitMetricRow('Total Slab Area')).toBe(true)
    expect(isUnitMetricRow('Cost Per SqFt')).toBe(true)
    expect(isUnitMetricRow('Total Built-up', 'SFT')).toBe(true)
    expect(isUnitMetricRow('TOTAL AMOUNT WITH TAX')).toBe(false)
    expect(isUnitMetricRow('Grand Total')).toBe(false)
  })

  it('rankTotalRow ladder vocabulary', () => {
    expect(rankTotalRow('APPROVAL FOR TOTAL AMOUNT TO ENTER IN ERP SYSTEM')).toBe(3)
    expect(rankTotalRow('Total Estimated Costing')).toBe(3)
    expect(rankTotalRow('TOTAL AMOUNT WITH TAX')).toBe(3)
    expect(rankTotalRow('Grand Total')).toBe(2)
    expect(rankTotalRow('Sub Total')).toBe(1)
    expect(rankTotalRow('Anti termite treatment')).toBeNull()
  })

  it('ladderRoleFor classification', () => {
    expect(ladderRoleFor('GST 18%')).toBe('tax')
    expect(ladderRoleFor('Payment RA01 on Previous WO')).toBe('addon')
    expect(ladderRoleFor('MISCELLANEOUS AMOUNT FOR MATERIAL SHIFTING ETC.')).toBe('addon')
    expect(ladderRoleFor('Trade Discount')).toBe('discount')
    expect(ladderRoleFor('Internal painting on walls')).toBe('item')
  })

  it('category hint variants', () => {
    expect(extractCategoryHint([['main category: 8 plumbing']])).toMatchObject({ mainCategoryCode: '8' })
    expect(extractCategoryHint([['just a title row']])).toBeNull()
    expect(extractCategoryHint([])).toBeNull()
  })

  it('scanTotalsWithoutHeader needs exactly one numeric cell + a total-ish label', () => {
    expect(scanTotalsWithoutHeader([['Total Amount', 450000]])).toHaveLength(1)
    expect(scanTotalsWithoutHeader([['Total Amount', 450000, 12]])).toHaveLength(0)
    expect(scanTotalsWithoutHeader([['Some note', 450000]])).toHaveLength(0)
  })

  it('detectColumns still classifies the classic header (regression)', () => {
    const cols = detectColumns(['Sr', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'])
    expect(cols.map(c => c.kind)).toEqual(['description', 'unit', 'qty', 'rate', 'amount'])
  })

  it('extractRows + applyLadderCut leave a total-less sheet untouched', () => {
    const aoa: unknown[][] = [
      ['Sr', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
      [1, 'Painting', 'Sft', 100, 10, 1000],
      [2, 'Primer', 'Sft', 100, 5, 500],
    ]
    const header = detectHeader(aoa)!
    const { rows, totalCandidates } = extractRows(aoa, header)
    expect(applyLadderCut(rows, totalCandidates, pickApprovalFigure(totalCandidates))).toHaveLength(2)
  })
})
