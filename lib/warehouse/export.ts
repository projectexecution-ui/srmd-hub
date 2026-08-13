/** One export pipe for every warehouse register.
 *
 *  The stock screen and the four entry registers are the same shape on paper —
 *  a title, the period it covers, grouped rows, a total — so they share one
 *  Excel writer and one PDF writer. Written once so a column added to a screen
 *  cannot quietly go missing from its export, which is how a printed register
 *  and the screen it came from end up disagreeing.
 *
 *  Client-side on purpose: no server round trip, and nothing to store.
 */
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { formatNumber } from '@/lib/utils'

export type Align = 'left' | 'right'

export type ExportColumn<T> = {
  header: string
  /** The display value, already formatted the way the screen shows it. */
  cell: (row: T) => string | number | null
  /** The raw number for Excel, so a spreadsheet can still add the column up. */
  raw?: (row: T) => number | null
  align?: Align
  width?: number
}

export type ExportGroup<T> = {
  label: string
  rows: T[]
  /** A bold band closing the group. One entry per column. */
  footer?: Array<string | number | null>
}

export type ExportSpec<T> = {
  /** File name stem — the date is appended. */
  name: string
  title: string
  /** "As on 15 Aug 2026", or "1 Aug 2026 → 31 Aug 2026". */
  period: string
  /** Context lines: which filters were in force. */
  notes?: string[]
  columns: Array<ExportColumn<T>>
  groups: Array<ExportGroup<T>>
  /** The grand total band. One entry per column. */
  total?: Array<string | number | null>
  /** Small print at the foot — caveats such as an indicative ₹ figure. */
  caveats?: string[]
}

const NAVY: [number, number, number] = [30, 41, 59]
const PAPER: [number, number, number] = [241, 245, 249]

function stamp(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function text(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'number' ? formatNumber(v, 0) : v
}

/** Excel — the same rows flat, with real numbers so they can be pivoted.
 *
 *  The group becomes a COLUMN rather than a heading band: a spreadsheet gets
 *  filtered, and a filter cannot see a heading row. */
export function exportXlsx<T>(spec: ExportSpec<T>): void {
  const body: Array<Array<string | number>> = []
  for (const g of spec.groups) {
    for (const r of g.rows) {
      body.push([
        g.label,
        ...spec.columns.map(c => {
          const raw = c.raw?.(r)
          if (raw !== undefined && raw !== null) return raw
          const v = c.cell(r)
          return typeof v === 'number' ? v : (v ?? '')
        }),
      ])
    }
  }

  const rows: Array<Array<string | number>> = [
    [spec.title],
    [spec.period],
    ...(spec.notes ?? []).map(n => [n]),
    [],
    ['Group', ...spec.columns.map(c => c.header)],
    ...body,
  ]
  if (spec.total) rows.push([], ['Total', ...spec.total.map(v => v ?? '')])
  if (spec.caveats?.length) rows.push([], ...spec.caveats.map(c => [c]))

  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = [{ wch: 24 }, ...spec.columns.map(c => ({ wch: c.width ?? 14 }))]

  const wb = XLSX.utils.book_new()
  // Excel refuses a sheet name over 31 chars or containing : \ / ? * [ ]
  XLSX.utils.book_append_sheet(wb, sheet, spec.title.replace(/[:\\/?*[\]]/g, '').slice(0, 31))
  XLSX.writeFile(wb, `${spec.name}-${stamp()}.xlsx`)
}

/** PDF — the register as a document somebody signs and files. */
export function exportPdf<T>(spec: ExportSpec<T>): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const columns = spec.columns.map(c => ({ header: c.header, dataKey: c.header }))
  const columnStyles = Object.fromEntries(
    spec.columns.map(c => [c.header, { halign: c.align ?? 'left' }]),
  )

  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 46, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold').setFontSize(13)
  doc.text(spec.title, 28, 20)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text(spec.period, 28, 34)
  doc.text('SRMD Construction · Warehouse', W - 28, 34, { align: 'right' })

  let y = 62
  doc.setTextColor(71, 85, 105).setFontSize(8)
  for (const n of spec.notes ?? []) { doc.text(n, 28, y); y += 11 }
  if (spec.notes?.length) y += 5

  const cursor = () => {
    const t = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
    return t?.finalY ?? y
  }

  for (const g of spec.groups) {
    // Keep a group's caption with at least a couple of its rows: a heading
    // stranded at the foot of a page reads as an empty group.
    if (y > H - 110) { doc.addPage(); y = 40 }

    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...NAVY)
    doc.text(g.label, 28, y)
    y += 6

    const body = g.rows.map(r => {
      const o: Record<string, string> = {}
      for (const c of spec.columns) o[c.header] = text(c.cell(r))
      return o
    })
    if (g.footer) {
      const o: Record<string, string> = {}
      spec.columns.forEach((c, i) => { o[c.header] = text(g.footer![i]) })
      body.push(o)
    }
    const footerIndex = g.footer ? body.length - 1 : -1

    autoTable(doc, {
      startY: y,
      columns,
      body,
      columnStyles,
      margin: { left: 28, right: 28 },
      styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: PAPER, textColor: NAVY, fontStyle: 'bold' },
      didParseCell: data => {
        if (data.section === 'head') {
          data.cell.styles.halign = spec.columns[data.column.index]?.align ?? 'left'
        }
        if (data.section === 'body' && data.row.index === footerIndex) {
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.fillColor = [248, 250, 252]
        }
      },
    })
    y = cursor() + 20
  }

  if (spec.total) {
    if (y > H - 80) { doc.addPage(); y = 40 }
    autoTable(doc, {
      startY: y,
      columns,
      body: [Object.fromEntries(spec.columns.map((c, i) => [c.header, text(spec.total![i])]))],
      columnStyles,
      showHead: false,
      margin: { left: 28, right: 28 },
      styles: { fontSize: 8.5, cellPadding: 4, fontStyle: 'bold' },
      bodyStyles: { fillColor: [226, 232, 240], textColor: NAVY },
    })
    y = cursor() + 16
  }

  if (spec.caveats?.length) {
    doc.setFont('helvetica', 'italic').setFontSize(7.5).setTextColor(100, 116, 139)
    for (const c of spec.caveats) {
      if (y > H - 30) { doc.addPage(); y = 40 }
      doc.text(c, 28, y, { maxWidth: W - 56 })
      y += 11
    }
  }

  const printed = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
  })
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(148, 163, 184)
    doc.text(`Printed ${printed} IST`, 28, H - 14)
    doc.text(`${p} / ${pages}`, W - 28, H - 14, { align: 'right' })
  }

  doc.save(`${spec.name}-${stamp()}.pdf`)
}
