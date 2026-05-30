// Dump header rows so we can verify column assumptions.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as XLSX from 'xlsx'

const files = [
  ['banded', 'C:/Users/aksha/Downloads/PURCHINDENT_TO_ISSUE_RPT.xlsx'],
  ['flat',   'C:/Users/aksha/Downloads/PUR_PurchaseOrderReport_Narang (2).xlsx'],
]

for (const [label, path] of files) {
  console.log('\n=== ' + label + ' ===')
  const buf = readFileSync(resolve(path))
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const wb = XLSX.read(ab, { type: 'array', cellDates: false })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  const headerRow = label === 'banded' ? 4 : 7
  console.log(`  Header row (${headerRow}):`)
  for (let c = 0; c < (raw[headerRow]?.length ?? 0); c++) {
    const v = raw[headerRow][c]
    if (v != null && v !== '') {
      console.log(`    col ${String(c).padStart(2)}:  ${JSON.stringify(v)}`)
    }
  }
  // Dump first 20 data rows so we can see the actual indent/material/PO pattern
  console.log(`\n  First 20 non-empty data rows:`)
  let shown = 0
  for (let r = headerRow + 1; r < raw.length && shown < 20; r++) {
    const row = raw[r]
    if (!row) continue
    const hasData = row.some(v => v != null && v !== '')
    if (!hasData) continue
    const compact = row.map((v, c) => v != null && v !== '' ? `[${c}]${typeof v === 'string' ? v.slice(0, 30) : v}` : null).filter(Boolean).join(' | ')
    console.log(`    row ${String(r).padStart(2)}: ${compact}`)
    shown++
  }
}
