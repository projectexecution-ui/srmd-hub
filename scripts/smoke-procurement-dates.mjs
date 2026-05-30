// Specifically probe date handling. Reads a few sample rows raw out of
// the real Excels and shows what their date cells actually look like,
// then runs them through daysSince() to see what we report.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { parseProcurementReport } from '../lib/procurement/index.ts'
import { daysSince } from '../lib/procurement/shared.ts'

const files = [
  ['banded', 'C:/Users/aksha/Downloads/PURCHINDENT_TO_ISSUE_RPT.xlsx'],
  ['flat',   'C:/Users/aksha/Downloads/PUR_PurchaseOrderReport_Narang (2).xlsx'],
]

for (const [label, path] of files) {
  console.log('\n=== ' + label + ' (' + path.split('/').pop() + ') ===')
  const buf = readFileSync(resolve(path))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

  // 1. Show raw cell values for the first few date-bearing rows
  const wb = XLSX.read(ab, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  // Pick the date column index per format
  const idx = label === 'banded'
    ? { INDENT_DT: 5, PO_DATE: 15, GRN_DATE: 19 }
    : { INDENT_DATE: 8, PO_DATE: 14, INVOICE_DATE: 28 }
  const startRow = label === 'banded' ? 5 : 8
  console.log('  Date columns and their raw values (first 5 non-empty cells per column):')
  for (const [name, c] of Object.entries(idx)) {
    let shown = 0
    for (let r = startRow; r < raw.length && shown < 5; r++) {
      const v = raw[r]?.[c]
      if (v != null && v !== '') {
        console.log(`    ${name.padEnd(14)} row ${r}, col ${c}:  raw=${JSON.stringify(v)}  type=${typeof v}  daysSince=${daysSince(String(v))}`)
        shown++
      }
    }
  }

  // 2. Run through the parser and check what dates the LineRecord carries
  const result = parseProcurementReport(ab)
  console.log('\n  Parsed LineRecord sample (first 5):')
  const sample = result.projects[0]?.lines.slice(0, 5) ?? []
  for (const ln of sample) {
    console.log(`    indent=${ln.indentNo}  indentDate=${JSON.stringify(ln.indentDate)}  indentAgeDays=${ln.indentAgeDays}  oldestPoAge=${ln.oldestPoAgeDays}`)
  }
  console.log('  --- pending lines age summary:')
  const pending = result.projects.flatMap(p => p.lines).filter(l => l.pendingQty > 0)
  const withAge = pending.filter(l => l.indentAgeDays != null).length
  const nullAge = pending.length - withAge
  console.log(`    pending lines: ${pending.length}, with age: ${withAge}, missing age (null): ${nullAge}`)
}
