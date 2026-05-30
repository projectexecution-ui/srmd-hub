// Smoke test: read Aksha's real Excels through the parser + rollup,
// then mimic the API/JSON shape and the first few client-side reads
// (json.projects[0], json.projects.flatMap(p => p.indents), etc.).
// Run: node scripts/smoke-procurement.mjs

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseProcurementReport } from '../lib/procurement/index.ts'

const files = [
  'C:/Users/aksha/Downloads/PURCHINDENT_TO_ISSUE_RPT.xlsx',
  'C:/Users/aksha/Downloads/PUR_PurchaseOrderReport_Narang (2).xlsx',
]

for (const f of files) {
  const label = f.split('/').pop()
  console.log('\n=== ' + label + ' ===')
  try {
    const buf = readFileSync(resolve(f))
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const result = parseProcurementReport(ab)

    // Mimic the API response shape (after fix):
    const apiJson = {
      success: true,
      fileName: label,
      format: result.format,
      projects: result.projects,
    }

    // Mimic the client's reads:
    const firstProjectName = apiJson.projects[0]?.projectName ?? null
    const allIndents = apiJson.projects.flatMap(p => p.indents)
    const allLines = apiJson.projects.flatMap(s => s.lines)
    const pendingLines = allLines.filter(l => l.pendingQty > 0).length

    console.log('format:                ', result.format)
    console.log('projects:              ', result.projects.length)
    console.log('first project:         ', firstProjectName)
    console.log('total indents:         ', allIndents.length)
    console.log('total lines:           ', allLines.length)
    console.log('pending lines:         ', pendingLines)
    if (result.projects[0]) {
      const p = result.projects[0]
      console.log('first project totals:  ', {
        total: p.total,
        poDoneGrnReceived: p.poDoneGrnReceived,
        poRaisedGrnPending: p.poRaisedGrnPending,
        indentOnlyNoPo: p.indentOnlyNoPo,
        pendingValue: Math.round(p.pendingValue),
        totalGrnValue: Math.round(p.totalGrnValue),
        topVendors: p.topVendors.length,
        oldestPendingPo: p.oldestPendingPo?.indentNo ?? null,
        biggestPendingLine: p.biggestPendingLine?.material?.slice(0, 40) ?? null,
        worstVendor: p.worstVendor?.name ?? null,
      })
    }
  } catch (e) {
    console.error('FAILED:', e)
  }
}
