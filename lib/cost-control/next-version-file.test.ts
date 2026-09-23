import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { boqTemplateWorkbook } from './boq-template-xlsx'
import { buildBoqTemplateModel, BOQ_SHEET, BOQ_MEASURE_SHEET, BOQ_META_SHEET } from './boq-template'
import { isStandardTemplateFile, nextVersionFilename, filenameFromDisposition } from './next-version-file'

// The next-version download serves the stored file's bytes untouched, so the
// only decisions to prove are: (1) we recognise our template from the bytes,
// (2) a legacy free-form workbook is refused so the seeded fallback runs, and
// (3) the bytes we would serve really do carry the formulas the engineer
// expects to find (D6*H6, the GST ROUND, the Working Sheet tab).

function templateBytes(): Uint8Array {
  const wb = boqTemplateWorkbook({
    projectCode: 'NRH', disciplineCode: '27', subSkillCode: '2701', blankRows: 10,
    seedRows: [
      { description: 'Excavation', unit: 'Cum', qty: 1050.5, qtyFormula: '946+104.5', ml: 250 },
      { description: 'Backfilling', unit: 'Cum', qty: 400, qtyFormula: "'Working Sheet'!G7", ml: 180 },
    ],
    versionNo: 2,
  })
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
}

describe('isStandardTemplateFile', () => {
  it('recognises our template from its bytes (very-hidden _meta marker)', () => {
    expect(isStandardTemplateFile(templateBytes())).toBe(true)
  })

  it('accepts an ArrayBuffer too (what fetch/blob hand over)', () => {
    const u8 = templateBytes()
    const ab = u8.slice().buffer as ArrayBuffer
    expect(isStandardTemplateFile(ab)).toBe(true)
  })

  it('refuses a legacy free-form workbook, so the seeded fallback runs', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Description', 'Qty', 'Rate', 'Amount'], ['Excavation', 10, 5, 50]]), 'Sheet1')
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    expect(isStandardTemplateFile(bytes)).toBe(false)
  })

  it('refuses a workbook whose _meta sheet carries a different marker', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['marker', 'SOMETHING-ELSE']]), BOQ_META_SHEET)
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer)
    expect(isStandardTemplateFile(bytes)).toBe(false)
  })

  it('returns false on garbage bytes instead of throwing', () => {
    expect(isStandardTemplateFile(new Uint8Array([1, 2, 3, 4]))).toBe(false)
  })
})

describe('the served bytes keep the working', () => {
  const wb = XLSX.read(templateBytes(), { type: 'buffer', cellFormula: true })
  const m = buildBoqTemplateModel({ blankRows: 10, seedRows: [{ description: 'a' }, { description: 'b' }], versionNo: 2 })
  const boq = wb.Sheets[BOQ_SHEET] as Record<string, XLSX.CellObject>

  it('Amount = Qty × Rate formula survives (D6*H6)', () => {
    expect(boq[`I${m.itemRowStart}`]?.f).toBe(`D${m.itemRowStart}*H${m.itemRowStart}`)
  })

  it('the engineer’s inline take-off and Working Sheet link survive in Qty', () => {
    expect(boq[`D${m.itemRowStart}`]?.f).toBe('946+104.5')
    expect(boq[`D${m.itemRowStart + 1}`]?.f).toMatch(/Working Sheet'!G/)
  })

  it('GST ROUND formula survives', () => {
    expect(boq[`I${m.gstRow}`]?.f).toMatch(/^ROUND\(/)
  })

  it('the Working Sheet tab and the very-hidden _meta sheet are still there', () => {
    expect(wb.SheetNames).toContain(BOQ_MEASURE_SHEET)
    expect(wb.SheetNames).toContain(BOQ_META_SHEET)
    const hidden = wb.Workbook?.Sheets?.find(s => s.name === BOQ_META_SHEET)?.Hidden
    expect(hidden).toBe(2)
  })
})

describe('nextVersionFilename', () => {
  it('stamps the NEXT version number in the standard template name shape', () => {
    const name = nextVersionFilename({
      projectName: 'New Row Houses', disciplineCode: '27', disciplineName: 'Earthwork - Road',
      subSkillCode: '2701', subSkillName: 'Excavation', versionNo: 2, dateText: '23 Sep 2026',
    })
    // Same cleaner as a fresh template's name: " - " collapses to "---" (dashes are kept).
    expect(name).toBe('BOQ_New-Row-Houses_27-Earthwork---Road_2701-Excavation_v2_23-Sep-2026.xlsx')
  })
})

describe('filenameFromDisposition', () => {
  it('reads the quoted filename', () => {
    expect(filenameFromDisposition('attachment; filename="BOQ_x_v2.xlsx"')).toBe('BOQ_x_v2.xlsx')
  })
  it('reads an unquoted filename', () => {
    expect(filenameFromDisposition('attachment; filename=BOQ_x_v2.xlsx')).toBe('BOQ_x_v2.xlsx')
  })
  it('returns null when absent', () => {
    expect(filenameFromDisposition(null)).toBeNull()
    expect(filenameFromDisposition('inline')).toBeNull()
  })
})
