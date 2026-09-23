// "Raise next version" hands the engineer their PREVIOUS version's Excel —
// the very bytes they uploaded — renamed as v(N+1). Nothing is regenerated,
// so the Working Sheet take-off, every formula (D6*H6, the GST ROUND, the
// engineer's own =946+104.5 quantities), remarks and formatting all survive.
//
// Before 23 Sep 2026 the next-version download was a FRESH template seeded
// from cc_excel_rows (values only). A sheet whose rows had been through
// "Upload revised Excel" (cc_replace_ws_excel nulls qty_formula) came back
// as plain numbers — "the previous working with formula is not coming".
//
// This module is the small pure-ish part of that route (imports xlsx like
// boq-template-xlsx.ts) so vitest can prove the decisions on real bytes.

import * as XLSX from 'xlsx'
import { BOQ_META_SHEET, boqTemplateFilename, type BoqTemplateOptions } from './boq-template'
import { detectTemplate } from './boq-template-parse'

/** True when the uploaded workbook is our standard BOQ template (carries the
 *  very-hidden _meta marker). Only that sheet is parsed, so this stays cheap
 *  on a 300 KB engineer workbook. A legacy free-form upload returns false and
 *  the caller falls back to the seeded fresh template. */
export function isStandardTemplateFile(buf: ArrayBuffer | Uint8Array): boolean {
  try {
    const wb = XLSX.read(buf, { type: buf instanceof Uint8Array ? 'buffer' : 'array', sheets: [BOQ_META_SHEET] })
    const meta = wb.Sheets[BOQ_META_SHEET]
    if (!meta) return false
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(meta, { header: 1, defval: null })
    return detectTemplate([{ name: BOQ_META_SHEET, aoa }]).isTemplate
  } catch {
    return false
  }
}

/** The download name for the previous file served as the next version —
 *  same shape as a fresh template's name (BOQ_<project>_<disc>_<sub>_v<N+1>_<date>.xlsx)
 *  so it sorts beside the engineer's other downloads. */
export function nextVersionFilename(opts: BoqTemplateOptions & { versionNo: number }): string {
  return boqTemplateFilename(opts)
}

/** Parse the filename out of a Content-Disposition header (ASCII form only —
 *  our names are cleaned to [\w.-]). */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const m = /filename="?([^";]+)"?/i.exec(header)
  return m?.[1]?.trim() || null
}
