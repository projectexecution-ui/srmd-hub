// Qty/amount provenance: pull the source sheet + cell out of an Excel formula
// so "where did this number come from?" has an answer without re-opening the
// workbook. Pure + tiny; unit-tested.
//
//   =Measurement!D11      → { sheet: 'Measurement', cell: 'D11' }
//   ='Take Off'!$D$11     → { sheet: 'Take Off',    cell: 'D11' }
//   =D11*H11              → { sheet: null,          cell: 'D11' }  (same-sheet)
//   =SUM(E6:G6)          → { sheet: null,          cell: 'E6' }   (first ref)

export interface SourceRef { sheet: string | null; cell: string | null }

const QUOTED_SHEET = /'([^']+)'!\$?([A-Z]{1,3})\$?(\d{1,7})/
const BARE_SHEET   = /([A-Za-z_][A-Za-z0-9_.]*)!\$?([A-Z]{1,3})\$?(\d{1,7})/
const SAME_SHEET   = /\$?([A-Z]{1,3})\$?(\d{1,7})/

export function parseSourceRef(formula: string | null | undefined): SourceRef {
  if (!formula) return { sheet: null, cell: null }
  const f = formula.replace(/^=/, '')

  const q = QUOTED_SHEET.exec(f)
  if (q) return { sheet: q[1], cell: `${q[2]}${q[3]}` }

  const b = BARE_SHEET.exec(f)
  if (b) return { sheet: b[1], cell: `${b[2]}${b[3]}` }

  const s = SAME_SHEET.exec(f)
  if (s) return { sheet: null, cell: `${s[1]}${s[2]}` }

  return { sheet: null, cell: null }
}
