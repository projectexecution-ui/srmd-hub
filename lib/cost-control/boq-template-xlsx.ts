// XLSX writer for the standard BOQ template. The ONLY file in the template
// family that imports xlsx (mirrors excel-parse-adapter.ts), so the pure
// model in boq-template.ts stays test-friendly.

import * as XLSX from 'xlsx'
import {
  buildBoqTemplateModel,
  boqTemplateFilename,
  type BoqTemplateOptions,
  type BoqSheetModel,
} from './boq-template'

function sheetFromModel(m: BoqSheetModel): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  for (const [address, cell] of Object.entries(m.cells)) {
    const c: XLSX.CellObject = { t: cell.t } as XLSX.CellObject
    if (cell.v !== undefined) (c as { v: unknown }).v = cell.v
    if (cell.f !== undefined) (c as { f: string }).f = cell.f
    if (cell.z !== undefined) (c as { z: string }).z = cell.z
    ws[address] = c
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: m.lastRow - 1, c: m.lastCol } })
  if (m.merges.length) ws['!merges'] = m.merges.map(mg => ({ s: mg.s, e: mg.e }))
  if (m.cols.length) ws['!cols'] = m.cols
  return ws
}

/** Build the standard template as a SheetJS workbook. */
export function boqTemplateWorkbook(opts: BoqTemplateOptions = {}): XLSX.WorkBook {
  const model = buildBoqTemplateModel(opts)
  const wb = XLSX.utils.book_new()
  for (const m of model.sheets) {
    const ws = sheetFromModel(m)
    XLSX.utils.book_append_sheet(wb, ws, m.name)
    if (m.visibility === 'veryHidden') XLSX.utils.book_set_sheet_visibility(wb, m.name, 2)
    else if (m.visibility === 'hidden') XLSX.utils.book_set_sheet_visibility(wb, m.name, 1)
  }
  return wb
}

/** Client-only: build + trigger a browser download of the template. */
export function downloadBoqTemplate(opts: BoqTemplateOptions = {}): void {
  const wb = boqTemplateWorkbook(opts)
  XLSX.writeFile(wb, boqTemplateFilename(opts))
}
