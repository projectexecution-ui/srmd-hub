'use client'
import { useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Button } from '@/components/ui/button'
import { FileDown, Loader2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { istTime, type DailyMovementReport } from '@/lib/inventory/daily-movement'

const nf = (n: number) => Number(n || 0).toLocaleString('en-IN')

function build(report: DailyMovementReport, dayLabel: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4', unit: 'pt' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 36
  let y = 44

  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(17, 24, 39)
  doc.text('Inventory — daily movement', marginX, y)
  y += 15
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(107, 114, 128)
  doc.text(dayLabel, marginX, y)
  const stamp = `Generated ${formatDateTime(new Date())}`
  doc.text(stamp, pageW - marginX - doc.getTextWidth(stamp), y)
  y += 16

  const kpis = [
    ['Entries', nf(report.kpi.entries)], ['Exits', nf(report.kpi.exits)],
    ['Transfers', nf(report.kpi.transfers)], ['Items', nf(report.kpi.itemsTouched)],
  ]
  const gap = 10
  const cardW = (pageW - marginX * 2 - gap * 3) / 4
  kpis.forEach(([label, value], i) => {
    const x = marginX + i * (cardW + gap)
    doc.setDrawColor(229, 231, 235); doc.setFillColor(249, 250, 251)
    doc.roundedRect(x, y, cardW, 38, 5, 5, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 114, 128)
    doc.text(label.toUpperCase(), x + 8, y + 14)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(17, 24, 39)
    doc.text(value, x + 8, y + 31)
  })
  y += 38 + 16

  const section = (title: string, rgb: [number, number, number], head: string[], body: (string)[][]) => {
    if (body.length === 0) return
    if (y > pageH - 90) { doc.addPage(); y = 44 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(rgb[0], rgb[1], rgb[2])
    doc.text(`${title}  (${body.length})`, marginX, y)
    autoTable(doc, {
      startY: y + 6,
      head: [head],
      body,
      margin: { left: marginX, right: marginX },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [31, 41, 55] },
      headStyles: { fillColor: rgb, textColor: 255, fontSize: 7.5 },
      alternateRowStyles: { fillColor: [250, 250, 249] },
      columnStyles: { [head.length - 2]: { halign: 'right' }, [head.length - 1]: { halign: 'right' } },
    })
    // @ts-expect-error lastAutoTable is attached at runtime
    y = (doc.lastAutoTable?.finalY ?? y) + 18
  }

  section('Entries — into store', [22, 163, 74], ['Item', 'Type', 'Store', 'By', 'Qty', 'Time'],
    report.entries.map(l => [l.itemName, l.type, l.store, l.actor, `${nf(l.qty)} ${l.unit}`, istTime(l.at)]))
  section('Exits — out of store', [220, 38, 38], ['Item', 'Type', 'Store', 'By', 'Qty', 'Time'],
    report.exits.map(l => [l.itemName, l.type, l.store, l.actor, `${nf(l.qty)} ${l.unit}`, istTime(l.at)]))
  section('Transfers — store to store', [37, 99, 235], ['Item', 'From', 'To', 'By', 'Qty', 'Time'],
    report.transfers.map(t => [t.itemName, t.fromStore, t.toStore, t.actor, `${nf(t.qty)} ${t.unit}`, istTime(t.at)]))
  section('Stock corrections', [124, 58, 237], ['Item', 'Store', 'By', 'Note', 'Qty', 'Time'],
    report.adjustments.map(l => [l.itemName, l.store, l.actor, l.remarks || '—', `${nf(l.qty)} ${l.unit}`, istTime(l.at)]))

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(156, 163, 175)
    doc.text(`CT HUB · Inventory daily movement · page ${p} of ${pages}`, marginX, pageH - 18)
  }
  return doc
}

export function DailyReportActions({ report, dayLabel, date }: {
  report: DailyMovementReport; dayLabel: string; date: string
}) {
  const [busy, setBusy] = useState(false)
  const empty = report.entries.length + report.exits.length + report.transfers.length + report.adjustments.length === 0
  return (
    <Button size="sm" variant="outline" disabled={busy || empty}
      onClick={() => { setBusy(true); try { build(report, dayLabel).save(`Daily-Movement_${date}.pdf`) } finally { setBusy(false) } }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      PDF
    </Button>
  )
}
