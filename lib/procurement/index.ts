// Entry point for the procurement library. Auto-detects which IN4 report
// has been uploaded and routes to the right parser. Both parsers emit
// the same LineRecord[] shape; the rollup is shared.

import * as XLSX from 'xlsx'
import type { ParseResult, ReportFormat } from './types'
import { isBanded, parseBanded } from './parsers/banded'
import { isFlat, parseFlat } from './parsers/flat'
import { buildProjectSummaries } from './rollup'

export * from './types'

/** Sniff which format the buffer is in. Returns null if neither matches. */
export function detectFormat(buffer: ArrayBuffer): ReportFormat | null {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
    header: 1, defval: null,
  }) as (string | number | null)[][]
  if (isBanded(raw)) return 'banded'
  if (isFlat(raw)) return 'flat'
  return null
}

/** Parse either supported report format. Throws when the format isn't recognised. */
export function parseProcurementReport(buffer: ArrayBuffer): ParseResult {
  const format = detectFormat(buffer)
  if (format == null) {
    throw new Error(
      'This Excel doesn’t match either supported IN4 report. ' +
      'Expected: PURCHINDENT_TO_ISSUE_RPT or PUR_PurchaseOrderReport_*.xlsx',
    )
  }
  const lines = format === 'banded' ? parseBanded(buffer) : parseFlat(buffer)
  const projects = buildProjectSummaries(lines)
  return { format, projects }
}
