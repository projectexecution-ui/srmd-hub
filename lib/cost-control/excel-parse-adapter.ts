// XLSX ↔ pure-analyzer glue. This is the ONLY file in the excel-parse
// family that imports xlsx — the analyzer itself takes plain AoA so the
// vitest suite needs no workbook fixtures.

import * as XLSX from 'xlsx'
import type { SheetInput } from './excel-parse'

export function workbookToSheetInputs(wb: XLSX.WorkBook): SheetInput[] {
  return wb.SheetNames.map(name => {
    const sheet = wb.Sheets[name]
    if (!sheet || !sheet['!ref']) return { name, aoa: [] as unknown[][] }
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    const formulaOf = (r: number, c: number): string | null => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as { f?: string } | undefined
      return cell?.f != null ? String(cell.f) : null
    }
    return { name, aoa, formulaOf }
  })
}
