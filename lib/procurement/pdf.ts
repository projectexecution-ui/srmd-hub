// One-page follow-up summary PDF for the Indent → PO Tracker.
//
// This is the artifact a PM prints or forwards to management: the headline
// numbers, then the two lists that actually need chasing — biggest/oldest
// pending receipts, and the oldest indents still without a PO. Deliberately
// NOT a full data dump (that's what the per-group CSV is for).
//
// Note: jsPDF's built-in Helvetica has no ₹ glyph, so money is rendered as
// "Rs …" here (same convention as the WhatsApp share text).
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { LineRecord } from './types'

function rs(n: number): string {
  if (n >= 1e7) return `Rs ${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `Rs ${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `Rs ${(n / 1e3).toFixed(1)} K`
  return `Rs ${Math.round(n).toLocaleString('en-IN')}`
}
const shortIndent = (no: string) =>
  no.replace('IND/SRASSK/', '').replace('IND/SRET/', '').replace('IND/SRJT/', '')

const MAX_ROWS = 25

export function buildTrackerSummaryPdf(
  lines: LineRecord[],
  projectLabel: string,
  savedAtLabel: string,
): void {
  const pending = lines.filter(l => l.pendingQty > 0)
  const needsPo = lines.filter(l => l.status === 'no_po')

  const pendingValue = pending.reduce((s, l) => s + l.pendingValue, 0)
  const pendingOverdue = pending.filter(l => (l.indentAgeDays ?? 0) >= 30).length
  const needsPoOverdue = needsPo.filter(l => (l.indentAgeDays ?? 0) >= 30).length

  const doc = new jsPDF({ orientation: 'portrait', format: 'a4', unit: 'pt' })
  const pageW = doc.internal.pageSize.getWidth()
  const marginX = 40
  let y = 46

  // ── Header ──────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(124, 45, 18)
  doc.text('Indent → PO — Follow-up summary', marginX, y)
  y += 18
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(120, 113, 108)
  doc.text(projectLabel, marginX, y)
  const stamp = `Data as of ${savedAtLabel}`
  doc.text(stamp, pageW - marginX - doc.getTextWidth(stamp), y)
  y += 20

  // ── KPI strip ───────────────────────────────────────────
  const kpis: { label: string; value: string; warn?: boolean }[] = [
    { label: 'Pending receipts', value: String(pending.length) },
    { label: 'Outstanding value', value: rs(pendingValue) },
    { label: 'Awaiting a PO', value: String(needsPo.length) },
    { label: '30+ days overdue', value: String(pendingOverdue + needsPoOverdue), warn: (pendingOverdue + needsPoOverdue) > 0 },
  ]
  const gap = 10
  const cardW = (pageW - marginX * 2 - gap * (kpis.length - 1)) / kpis.length
  kpis.forEach((k, i) => {
    const x = marginX + i * (cardW + gap)
    doc.setDrawColor(231, 229, 228); doc.setFillColor(k.warn ? 254 : 250, k.warn ? 242 : 250, k.warn ? 242 : 249)
    doc.roundedRect(x, y, cardW, 46, 5, 5, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 113, 108)
    doc.text(k.label.toUpperCase(), x + 8, y + 15)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
    doc.setTextColor(k.warn ? 185 : 41, k.warn ? 28 : 37, k.warn ? 28 : 36)
    doc.text(k.value, x + 8, y + 35)
  })
  y += 46 + 22

  // ── Pending — chase first (biggest value, then oldest) ──
  const pendingChase = [...pending]
    .sort((a, b) => (b.pendingValue - a.pendingValue) || ((b.indentAgeDays ?? 0) - (a.indentAgeDays ?? 0)))
    .slice(0, MAX_ROWS)

  if (pendingChase.length > 0) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(146, 64, 14)
    doc.text(`Pending receipts — chase first  (${pending.length} total)`, marginX, y)
    y += 6
    autoTable(doc, {
      startY: y + 4,
      head: [['Vendor', 'Indent', 'Material', 'Pending', 'Value', 'Days']],
      body: pendingChase.map(l => [
        (l.supplier || '—').slice(0, 26),
        shortIndent(l.indentNo),
        (l.material || '—').slice(0, 40),
        `${l.pendingQty.toLocaleString('en-IN')} ${l.uom}`,
        l.pendingValue > 0 ? rs(l.pendingValue) : '—',
        String(l.indentAgeDays ?? '—'),
      ]),
      margin: { left: marginX, right: marginX },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [41, 37, 36] },
      headStyles: { fillColor: [146, 64, 14], textColor: 255, fontSize: 8 },
      alternateRowStyles: { fillColor: [250, 250, 249] },
      columnStyles: {
        3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
      },
    })
    // @ts-expect-error autoTable attaches lastAutoTable on the doc at runtime.
    y = (doc.lastAutoTable?.finalY ?? y) + 24
  }

  // ── Needs PO — oldest waiting ───────────────────────────
  const needsPoChase = [...needsPo]
    .sort((a, b) => (b.indentAgeDays ?? 0) - (a.indentAgeDays ?? 0))
    .slice(0, MAX_ROWS)

  if (needsPoChase.length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 140) { doc.addPage(); y = 46 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(153, 27, 27)
    doc.text(`Still needing a PO — oldest first  (${needsPo.length} total)`, marginX, y)
    y += 6
    autoTable(doc, {
      startY: y + 4,
      head: [['Indent', 'Block', 'Material', 'Qty needed', 'Days waiting']],
      body: needsPoChase.map(l => [
        shortIndent(l.indentNo),
        (l.block || '—').slice(0, 22),
        (l.material || '—').slice(0, 44),
        `${l.indentQty.toLocaleString('en-IN')} ${l.uom}`,
        String(l.indentAgeDays ?? '—'),
      ]),
      margin: { left: marginX, right: marginX },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [41, 37, 36] },
      headStyles: { fillColor: [153, 27, 27], textColor: 255, fontSize: 8 },
      alternateRowStyles: { fillColor: [250, 250, 249] },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } },
    })
  }

  // ── Footer on every page ────────────────────────────────
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(168, 162, 158)
    const foot = `CT HUB · Indent → PO Tracker · page ${p} of ${pages}`
    doc.text(foot, marginX, doc.internal.pageSize.getHeight() - 20)
  }

  const safe = projectLabel.replace(/[^\w-]+/g, '_').slice(0, 40) || 'tracker'
  doc.save(`${safe}_Indent-PO-Summary_${new Date().toISOString().slice(0, 10)}.pdf`)
}
