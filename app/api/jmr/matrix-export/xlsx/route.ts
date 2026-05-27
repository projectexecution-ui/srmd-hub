import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { buildMatrix } from '@/lib/jmr/matrix'
import { getJmrSettings } from '@/lib/jmr/settings'
import { getMyPermissions, can } from '@/lib/auth'
import { todayISO } from '@/lib/jmr/format'

export async function GET(req: NextRequest) {
  const perms = await getMyPermissions()
  if (!can(perms, 'jmr', 'view')) return new NextResponse('Forbidden', { status: 403 })

  const sp = req.nextUrl.searchParams
  const settings = await getJmrSettings()
  const data = await buildMatrix({
    projectIds: sp.getAll('project'),
    contractorId: sp.get('contractor'),
    subProjectIds: sp.getAll('sp').length ? sp.getAll('sp') : null,
    category: (sp.get('cat') as 'equipment' | 'manpower' | 'both') ?? 'both',
    dateFrom: sp.get('from'),
    dateTo: sp.get('to') ?? todayISO(),
    gstRatePct: settings.gst_rate_pct,
  })

  // buildMatrix now returns the active column set (parent + sub-projects) and
  // already drops the legacy 'unassigned' bucket — no extra append needed.
  const subProjects = data.subProjects

  // Build header rows
  const topHeader: (string | number)[] = ['Sr.', 'Item', 'Unit', 'Rate']
  const subHeader: (string | number)[] = ['', '', '', '']
  for (const s of subProjects) {
    topHeader.push(s.code || s.name, '')
    subHeader.push('Qty', 'Amount')
  }
  topHeader.push('Total')
  subHeader.push('')

  const equipmentRows = data.rows.filter(r => r.category === 'equipment')
  const manpowerRows = data.rows.filter(r => r.category === 'manpower')

  const sheetData: (string | number)[][] = [topHeader, subHeader]

  let sr = 0
  function pushRow(row: typeof data.rows[number]) {
    sr++
    const cols: (string | number)[] = [sr, row.item_name, row.unit, row.rate ?? '']
    for (const s of subProjects) {
      const c = row.cells[s.id]
      cols.push(c ? c.qty : 0, c ? c.amount : 0)
    }
    cols.push(row.total.amount)
    sheetData.push(cols)
  }

  if (equipmentRows.length > 0) {
    sheetData.push(['EQUIPMENT SUPPLY'])
    equipmentRows.forEach(pushRow)
  }
  if (manpowerRows.length > 0) {
    sheetData.push(['MANPOWER (FOR 8 HOURS) SUPPLY'])
    manpowerRows.forEach(pushRow)
  }

  // Sub-total + GST + Grand total
  const stRow: (string | number)[] = ['', 'SUB TOTAL', '', '']
  for (const s of subProjects) stRow.push('', data.subTotalsBySubProject[s.id] ?? 0)
  stRow.push(data.subTotalAll)
  sheetData.push(stRow)

  const gstRow: (string | number)[] = ['', `GST ${data.gstRate}%`]
  for (let i = 0; i < 2 + subProjects.length * 2 + 0; i++) gstRow.push('')
  gstRow.push(data.gstAmount)
  sheetData.push(gstRow)

  const gtRow: (string | number)[] = ['', 'GRAND TOTAL']
  for (let i = 0; i < 2 + subProjects.length * 2 + 0; i++) gtRow.push('')
  gtRow.push(data.grandTotal)
  sheetData.push(gtRow)

  const ws = XLSX.utils.aoa_to_sheet(sheetData)
  // Set column widths
  ws['!cols'] = [
    { wch: 5 }, { wch: 38 }, { wch: 6 }, { wch: 10 },
    ...subProjects.flatMap(() => [{ wch: 8 }, { wch: 12 }]),
    { wch: 14 },
  ]
  // Merge sub-project header cells
  ws['!merges'] = []
  let colIdx = 4
  for (let i = 0; i < subProjects.length; i++) {
    ws['!merges'].push({ s: { r: 0, c: colIdx }, e: { r: 0, c: colIdx + 1 } })
    colIdx += 2
  }
  // Freeze top 2 rows + first 4 cols
  ws['!freeze'] = { xSplit: 4, ySplit: 2 }

  const wb = XLSX.utils.book_new()
  const labelFromProjects = data.projects.length === 1
    ? (data.projects[0].code || data.projects[0].name || 'JMR')
    : `${data.projects.length} projects`
  const sheetName = labelFromProjects.slice(0, 30)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const exportTag = data.projects.length === 1
    ? (data.projects[0].code || 'export')
    : `${data.projects.length}-projects`
  const fileName = `JMR_${exportTag}_${data.dateTo}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
