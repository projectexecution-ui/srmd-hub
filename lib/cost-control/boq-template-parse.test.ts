import { describe, it, expect } from 'vitest'
import {
  parseTemplateSheet,
  detectTemplate,
  reconcileAgainstClaim,
} from './boq-template-parse'
import { BOQ_TEMPLATE_MARKER, BOQ_META_SHEET } from './boq-template'

// Column order: Sr | Description | Unit | Qty | Material | Installation | M+L | Rate | Amount | Remarks
const HEADER = ['Sr', 'Description', 'Unit', 'Qty', 'Material', 'Installation', 'M+L', 'Rate', 'Amount', 'Remarks']
type Cell = string | number | null
const item = (sr: number, desc: string, unit: Cell, qty: Cell, mat: Cell, inst: Cell, ml: Cell, remarks: Cell = null): Cell[] =>
  [sr, desc, unit, qty, mat, inst, ml, /*rate cache*/ 99999, /*amt cache*/ 99999, remarks]

/** Build a template BOQ AoA with title rows, header, items, and a ladder. */
function sheet(items: Cell[][], opts: { contPct?: Cell; gstPct?: Cell; statedGrand?: Cell } = {}): unknown[][] {
  const aoa: unknown[][] = [
    ['STANDARD BOQ — 03 Civil'],
    ['Project: NGH'],
    ['rule note…'],
    [],
    HEADER,
    ...items,
  ]
  aoa.push([null, null, null, null, null, null, 'Subtotal', null, 12345])
  aoa.push([null, 'Contingency', null, null, null, null, null, opts.contPct ?? 5, 0])
  aoa.push([null, 'GST', null, null, null, null, null, opts.gstPct ?? 18, 0])
  aoa.push([null, null, null, null, null, null, 'GRAND TOTAL', null, opts.statedGrand ?? null])
  return aoa
}

describe('parseTemplateSheet — clean sheet reconciles', () => {
  const items = [
    item(1, 'RCC footings', 'Cum', 96, 6800, 900, null),      // split rate → 7700
    item(2, 'RCC slabs', 'Cum', 165, null, null, 7900),        // composite M+L
    item(3, 'Site office', 'LS', 1, null, null, 250000),       // lump sum
  ]
  const subtotal = 96 * 7700 + 165 * 7900 + 250000            // = 2,286,700
  const cont = Math.round(subtotal * 0.05)
  const gst = Math.round((subtotal + cont) * 0.18)
  const grand = subtotal + cont + gst
  const res = parseTemplateSheet(sheet(items, { statedGrand: grand }))

  it('finds exactly 3 item rows and recomputes rate/amount', () => {
    expect(res.itemRows).toHaveLength(3)
    expect(res.itemRows[0].rate).toBe(7700)
    expect(res.itemRows[0].amount).toBe(96 * 7700)
    expect(res.itemRows[2].amount).toBe(250000)
  })

  it('recomputes the whole ladder', () => {
    expect(res.ladder?.subtotal).toBe(subtotal)
    expect(res.ladder?.contingency).toBe(cont)
    expect(res.ladder?.gst).toBe(gst)
    expect(res.ladder?.grandTotal).toBe(grand)
  })

  it('reconciles against the sheet stated grand total', () => {
    expect(res.reconciled).toBe(true)
    expect(res.reconcileDiff).toBe(0)
    expect(res.errorCount).toBe(0)
  })

  it('ignores tampered cached Rate/Amount cells (recompute wins)', () => {
    // cached rate/amount were 99999 in every item; recompute overrides.
    expect(res.itemRows.every(r => r.rate !== 99999)).toBe(true)
  })
})

describe('parseTemplateSheet — per-row validation', () => {
  it('flags a row that filled BOTH split and M+L', () => {
    const res = parseTemplateSheet(sheet([item(1, 'Bad row', 'Cum', 10, 500, 200, 700)]))
    expect(res.itemRows[0].errors.join(' ')).toMatch(/both/i)
    expect(res.errorCount).toBeGreaterThan(0)
  })

  it('flags a missing quantity', () => {
    const res = parseTemplateSheet(sheet([item(1, 'No qty', 'Cum', null, 500, 200, null)]))
    expect(res.itemRows[0].errors.join(' ')).toMatch(/quantity/i)
  })

  it('flags a missing description', () => {
    const res = parseTemplateSheet(sheet([item(1, '', 'Cum', 10, 500, null, null)]))
    expect(res.itemRows[0].errors.join(' ')).toMatch(/description/i)
  })

  it('warns (not errors) on a non-standard unit', () => {
    const res = parseTemplateSheet(sheet([item(1, 'Odd unit', 'furlong', 10, 500, null, null)]))
    expect(res.itemRows[0].errors).toHaveLength(0)
    expect(res.itemRows[0].warnings.join(' ')).toMatch(/not a standard unit/i)
  })

  it('accepts a negative quantity as a deduction', () => {
    const res = parseTemplateSheet(sheet([item(1, 'Deduct excess', 'Cum', -5, null, null, 1200)]))
    expect(res.itemRows[0].errors).toHaveLength(0)
    expect(res.itemRows[0].amount).toBe(-6000)
  })
})

describe('parseTemplateSheet — headings and blanks', () => {
  it('treats a description-only row as a heading, not an item', () => {
    const res = parseTemplateSheet(sheet([
      [null, 'A. SUBSTRUCTURE', null, null, null, null, null, null, null, null],
      item(1, 'RCC footings', 'Cum', 10, 5000, null, null),
    ]))
    expect(res.itemRows).toHaveLength(1)
    expect(res.rows.find(r => r.kind === 'heading')?.description).toBe('A. SUBSTRUCTURE')
  })
})

describe('parseTemplateSheet — reconciliation failure', () => {
  it('marks reconciled=false when the stated grand total is wrong', () => {
    const items = [item(1, 'RCC', 'Cum', 100, 5000, null, null)] // subtotal 500000
    const res = parseTemplateSheet(sheet(items, { statedGrand: 999999999 }))
    expect(res.reconciled).toBe(false)
    expect(Math.abs(res.reconcileDiff)).toBeGreaterThan(1000)
  })
})

describe('detectTemplate', () => {
  it('detects a workbook carrying the _meta marker', () => {
    const sheets = [
      { name: 'BOQ', aoa: [HEADER] },
      { name: BOQ_META_SHEET, aoa: [['marker', BOQ_TEMPLATE_MARKER], ['project_id', 'p1']] },
    ]
    const d = detectTemplate(sheets)
    expect(d.isTemplate).toBe(true)
    expect(d.meta.project_id).toBe('p1')
  })

  it('rejects a workbook without the meta sheet', () => {
    expect(detectTemplate([{ name: 'Sheet1', aoa: [HEADER] }]).isTemplate).toBe(false)
  })
})

describe('reconcileAgainstClaim', () => {
  it('accepts within 0.5%', () => {
    expect(reconcileAgainstClaim(1_000_000, 1_002_000).ok).toBe(true)
  })
  it('rejects beyond 0.5%', () => {
    expect(reconcileAgainstClaim(1_000_000, 1_100_000).ok).toBe(false)
  })
  it('rejects a missing claim', () => {
    expect(reconcileAgainstClaim(1_000_000, null).ok).toBe(false)
  })
})
