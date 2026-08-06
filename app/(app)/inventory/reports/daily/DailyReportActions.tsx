'use client'
import { useState } from 'react'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Button } from '@/components/ui/button'
import { FileDown, Loader2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { istTime, movementDetail, type DailyMovementReport } from '@/lib/inventory/daily-movement'

const nf = (n: number) => Number(n || 0).toLocaleString('en-IN')

// Shared catalogue brand palette (keep the two inventory PDFs visually a set).
const NAVY: [number, number, number] = [15, 42, 74]
const GOLD: [number, number, number] = [200, 162, 74]
const INK: [number, number, number] = [31, 41, 55]
const MUTE: [number, number, number] = [107, 114, 128]

function build(report: DailyMovementReport, dayLabel: string): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4', unit: 'pt' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 36

  // ── Masthead (matches the Material Catalogue) ──
  doc.setFillColor(...NAVY); doc.rect(0, 0, pageW, 76, 'F')
  doc.setFillColor(...GOLD); doc.rect(0, 76, pageW, 3, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(255, 255, 255)
  doc.text('Inventory — Daily Movement', marginX, 38)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(206, 214, 224)
  doc.text(dayLabel, marginX, 56)
  const stamp = `Generated ${formatDateTime(new Date())}`
  doc.setFontSize(8.5)
  doc.text(stamp, pageW - marginX - doc.getTextWidth(stamp), 56)
  const tag = `${nf(report.kpi.entries)} in · ${nf(report.kpi.exits)} out · ${nf(report.kpi.transfers)} moved`
  doc.setTextColor(...GOLD); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text(tag, marginX, 70)

  let y = 76 + 3 + 22

  const kpis: Array<[string, string, [number, number, number]]> = [
    ['Entries', nf(report.kpi.entries), [22, 101, 52]],
    ['Exits', nf(report.kpi.exits), [190, 24, 60]],
    ['Transfers', nf(report.kpi.transfers), [37, 99, 235]],
    ['Items', nf(report.kpi.itemsTouched), INK],
  ]
  const gap = 10
  const cardW = (pageW - marginX * 2 - gap * 3) / 4
  kpis.forEach(([label, value, tone], i) => {
    const x = marginX + i * (cardW + gap)
    doc.setDrawColor(229, 231, 235); doc.setFillColor(249, 250, 251)
    doc.roundedRect(x, y, cardW, 44, 5, 5, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTE)
    doc.text(label.toUpperCase(), x + 9, y + 15)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...tone)
    doc.text(value, x + 9, y + 35)
  })
  y += 44 + 18

  const section = (title: string, rgb: [number, number, number], head: string[], body: (string)[][]) => {
    if (body.length === 0) return
    if (y > pageH - 90) { doc.addPage(); y = 44 }
    // Coloured left-rule + title (colour stays semantic: in / out / move).
    doc.setFillColor(rgb[0], rgb[1], rgb[2])
    doc.roundedRect(marginX, y - 9, 3.5, 12, 1, 1, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(rgb[0], rgb[1], rgb[2])
    doc.text(`${title}  (${body.length})`, marginX + 9, y)
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

  const withEmg = (l: { isEmergency?: boolean }) => (l.isEmergency ? ' · EMERGENCY' : '')
  section('Entries — into store', [22, 163, 74], ['Item', 'Source', 'Store', 'By', 'Qty', 'Time'],
    report.entries.map(l => [l.itemName, movementDetail(l) || l.type, l.store, l.actor, `${nf(l.qty)} ${l.unit}`, istTime(l.at)]))
  section('Exits — out of store', [220, 38, 38], ['Item', 'For (project · purpose · request)', 'Store', 'By', 'Qty', 'Time'],
    report.exits.map(l => [l.itemName, (movementDetail(l) || '—') + withEmg(l), l.store, l.actor, `${nf(l.qty)} ${l.unit}`, istTime(l.at)]))
  section('Transfers — store to store', [37, 99, 235], ['Item', 'From', 'To', 'By', 'Qty', 'Time'],
    report.transfers.map(t => [t.itemName, t.fromStore, t.toStore, t.actor, `${nf(t.qty)} ${t.unit}`, istTime(t.at)]))
  section('Stock corrections', [124, 58, 237], ['Item', 'Note', 'Store', 'By', 'Qty', 'Time'],
    report.adjustments.map(l => [l.itemName, movementDetail(l) || '—', l.store, l.actor, `${nf(l.qty)} ${l.unit}`, istTime(l.at)]))

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE)
    doc.text('CT HUB · Inventory daily movement', marginX, pageH - 18)
    const rt = `Page ${p} of ${pages}`
    doc.text(rt, pageW - marginX - doc.getTextWidth(rt), pageH - 18)
  }
  return doc
}

export function DailyReportActions({ report, dayLabel, date }: {
  report: DailyMovementReport; dayLabel: string; date: string
}) {
  const [busy, setBusy] = useState(false)
  const empty = report.entries.length + report.exits.length + report.transfers.length + report.adjustments.length === 0
  return (
    <Button variant="outline" disabled={busy || empty}
      onClick={() => { setBusy(true); try { build(report, dayLabel).save(`Daily-Movement_${date}.pdf`) } finally { setBusy(false) } }}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
      PDF
    </Button>
  )
}
