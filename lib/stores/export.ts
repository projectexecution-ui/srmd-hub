/**
 * One export pipe for every register.
 *
 * The four registers are the same shape on paper — a title, the period it
 * covers, the filters that were in force, grouped rows, a total. Written once
 * so a column added to a screen cannot quietly go missing from its export,
 * which is how a printed register and the screen it came from end up
 * disagreeing with each other.
 *
 * Client-side: no server round trip and nothing to store. Imported lazily by
 * the screen so jsPDF and xlsx are not in the page's first load.
 */
import { fmtQty } from './core'
import { qtyLine, type RegisterGroup, type RegisterTotals } from './registers'
import type { StockLine } from './desk'
import { formatINR, formatDate } from '@/lib/utils'

export interface ExportSpec {
  title: string
  /** "1 Aug 2026 → 31 Aug 2026" — never blank. */
  period: string
  /** The filters in force, so a printed page says what it is a page OF. */
  notes: string[]
  groups: RegisterGroup[]
  grand: RegisterTotals
  /** False when nothing is priced, so the money columns are dropped entirely
   *  rather than printing a page of dashes. */
  showMoney: boolean
}

const NAVY: [number, number, number] = [30, 41, 59]
const PAPER: [number, number, number] = [241, 245, 249]

/** Today, in IST, for the file name and the printed footer. */
const stamp = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

const fileName = (title: string, ext: string) =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp()}.${ext}`

function headers(showMoney: boolean): string[] {
  const base = ['Date', 'Entry', 'Party', 'Item', 'Discipline', 'Where', 'Qty', 'Unit']
  return showMoney ? [...base, 'Rate', 'Amount'] : base
}

export async function exportRegister(as: 'xlsx' | 'pdf', spec: ExportSpec): Promise<void> {
  if (as === 'xlsx') return toExcel(spec)
  return toPdf(spec)
}

/* ── Excel — the same rows flat, with RAW numbers behind them ───────────── */

async function toExcel(spec: ExportSpec) {
  const XLSX = await import('xlsx')
  const rows: Array<Array<string | number | null>> = []

  rows.push([spec.title])
  rows.push([spec.period])
  if (spec.notes.length) rows.push([spec.notes.join(' · ')])
  rows.push([])
  rows.push(headers(spec.showMoney))

  for (const g of spec.groups) {
    rows.push([g.label])
    for (const r of g.rows) {
      // Quantities and money go in as NUMBERS, not formatted strings, so a
      // spreadsheet can still add the column up — which is the only reason
      // anyone asks for Excel rather than the PDF.
      const base: Array<string | number | null> = [
        r.day, r.entryNo, r.party ?? '', r.itemName, r.discipline ?? '', r.place ?? '', r.qty, r.unit,
      ]
      rows.push(spec.showMoney ? [...base, r.rate, r.amount] : base)
    }
    rows.push([`${g.label} — total`, '', '', '', '', '', qtyLine(g.totals), '',
      ...(spec.showMoney ? ['', g.totals.amount] : [])])
    rows.push([])
  }

  rows.push([`TOTAL — ${spec.grand.entries} entries · ${spec.grand.lines} lines`, '', '', '', '', '',
    qtyLine(spec.grand), '', ...(spec.showMoney ? ['', spec.grand.amount] : [])])
  if (spec.grand.amountPartial && spec.showMoney) {
    rows.push([]); rows.push(['The ₹ total is understated — some lines have no known rate.'])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 11 }, { wch: 17 }, { wch: 22 }, { wch: 40 }, { wch: 16 }, { wch: 24 },
    { wch: 11 }, { wch: 8 }, { wch: 11 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, spec.title.slice(0, 31))
  XLSX.writeFile(wb, fileName(spec.title, 'xlsx'))
}

/* ── PDF — a bound register ─────────────────────────────────────────────── */

async function toPdf(spec: ExportSpec) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()

  // Masthead
  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 54, 'F')
  doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(15)
  doc.text(spec.title.toUpperCase(), 32, 24)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text(spec.period, 32, 40)
  if (spec.notes.length) {
    doc.text(spec.notes.join('   ·   '), W - 32, 40, { align: 'right' })
  }

  const body: Array<Array<string>> = []
  for (const g of spec.groups) {
    body.push([`__GROUP__${g.label}`, '', '', '', '', '', qtyLine(g.totals), '',
      ...(spec.showMoney ? ['', g.totals.amount > 0 ? formatINR(g.totals.amount) : '—'] : [])])
    for (const r of g.rows) {
      const base = [r.day, r.entryNo, r.party ?? '—', r.itemName, r.discipline ?? '—', r.place ?? '—',
        fmtQty(r.qty), r.unit]
      body.push(spec.showMoney
        ? [...base, r.rate == null ? '—' : formatINR(r.rate), r.amount == null ? '—' : formatINR(r.amount)]
        : base)
    }
  }

  const money = spec.showMoney
  autoTable(doc, {
    startY: 68,
    head: [headers(money)],
    body,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', textColor: [30, 35, 45] },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [252, 252, 253] },
    columnStyles: {
      0: { cellWidth: 52 }, 1: { cellWidth: 76 }, 3: { cellWidth: money ? 150 : 210 },
      6: { halign: 'right', cellWidth: 52 }, 7: { cellWidth: 36 },
      ...(money ? { 8: { halign: 'right' as const, cellWidth: 56 }, 9: { halign: 'right' as const, cellWidth: 70 } } : {}),
    },
    // A group band is one row carrying a marker, drawn as a full-width heading.
    didParseCell: (d) => {
      // `raw` is the array we passed in; autotable types it loosely because it
      // also accepts an HTML row, which we never use.
      const raw = d.row.raw as unknown as Array<string> | undefined
      const first = String(raw?.[0] ?? '')
      if (first.startsWith('__GROUP__')) {
        d.cell.styles.fillColor = PAPER
        d.cell.styles.fontStyle = 'bold'
        d.cell.styles.fontSize = 8
        if (d.column.index === 0) d.cell.text = [first.replace('__GROUP__', '')]
      }
    },
    // Page numbers, so a printed register can be checked for missing sheets.
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight()
      doc.setFontSize(7).setTextColor(130)
      doc.text(`CT Hub · Material In & Out · printed ${stamp()}`, 32, h - 16)
      const page = doc.getNumberOfPages()
      doc.text(`Page ${page}`, W - 32, h - 16, { align: 'right' })
    },
  })

  // Grand total and the caveat
  const y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 68) + 14
  doc.setFillColor(...NAVY)
  doc.rect(32, y - 11, W - 64, 20, 'F')
  doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(9)
  doc.text(`TOTAL — ${spec.grand.entries} entries · ${spec.grand.lines} lines`, 40, y + 2)
  doc.text(qtyLine(spec.grand) + (money && spec.grand.amount > 0 ? `     ${formatINR(spec.grand.amount)}` : ''),
    W - 40, y + 2, { align: 'right' })

  if (spec.grand.amountPartial && money) {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(150, 80, 20)
    doc.text('The ₹ total is understated — some lines have no known rate.', 32, y + 24)
  }
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(130)
  doc.text('Quantities are totalled within each unit, never across.', 32, y + (spec.grand.amountPartial && money ? 36 : 24))

  doc.save(fileName(spec.title, 'pdf'))
}

/* ── Stock — the map's fifth report, on paper ───────────────────────────── */

export interface StockExportGroup {
  label: string
  rows: readonly StockLine[]
  items: number
  value: number
  unpriced: boolean
}

export interface StockExportSpec {
  /** "Stock by item" or "Stock by store" — whichever is on screen. */
  title: string
  /** "As on 31 Aug 2026" or "Right now" — never blank. */
  period: string
  /** What was searched or filtered, so the page says what it is a page OF. */
  notes: string[]
  groups: StockExportGroup[]
  grand: { lines: number; items: number; value: number; unpriced: boolean }
}

const STOCK_HEADERS = ['Item', 'Where', 'In hand', 'Unit', 'Last rate', 'Value', 'Last moved']

/**
 * The map lists Total Stock among its five reports — "Select Period · Select
 * Disciplines · Storage Location Wise" — and it was the one that existed only
 * as a screen. Aksha, 16 Sep 2026: a stock statement is the thing the HOD asks
 * to hold.
 *
 * Built from the SAME grouped rows the screen renders, for the same reason the
 * register export is: a column added to one cannot go missing from the other.
 */
export async function exportStock(as: 'xlsx' | 'pdf', spec: StockExportSpec): Promise<void> {
  if (as === 'xlsx') return stockToExcel(spec)
  return stockToPdf(spec)
}

const when = (at: string | null) => (at ? formatDate(at) : '—')

async function stockToExcel(spec: StockExportSpec) {
  const XLSX = await import('xlsx')
  const rows: Array<Array<string | number | null>> = []

  rows.push([spec.title])
  rows.push([spec.period])
  if (spec.notes.length) rows.push([spec.notes.join(' · ')])
  rows.push([])
  rows.push(STOCK_HEADERS)

  for (const g of spec.groups) {
    rows.push([g.label])
    for (const r of g.rows) {
      // Raw numbers, so the column can still be added up — which is the only
      // reason anybody asks for Excel rather than the PDF.
      rows.push([r.name, r.where, r.qty, r.unit, r.lastRate, r.value, when(r.lastMovedAt)])
    }
    rows.push([`${g.label} — ${g.items} item${g.items === 1 ? '' : 's'}`, '', '', '', '', g.value, ''])
    rows.push([])
  }

  rows.push([`TOTAL — ${spec.grand.items} items · ${spec.grand.lines} lines`, '', '', '', '', spec.grand.value, ''])
  if (spec.grand.unpriced) {
    rows.push([])
    rows.push(['The ₹ total is understated — some lines have no known rate.'])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [{ wch: 46 }, { wch: 30 }, { wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 13 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, spec.title.slice(0, 31))
  XLSX.writeFile(wb, fileName(spec.title, 'xlsx'))
}

async function stockToPdf(spec: StockExportSpec) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()

  doc.setFillColor(...NAVY)
  doc.rect(0, 0, W, 54, 'F')
  doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(15)
  doc.text(spec.title.toUpperCase(), 32, 24)
  doc.setFont('helvetica', 'normal').setFontSize(9)
  doc.text(spec.period, 32, 40)
  if (spec.notes.length) doc.text(spec.notes.join('   ·   '), W - 32, 40, { align: 'right' })

  const body: Array<Array<string>> = []
  for (const g of spec.groups) {
    body.push([`__GROUP__${g.label}`, `${g.items} item${g.items === 1 ? '' : 's'}`, '', '', '',
      g.value > 0 ? formatINR(g.value) + (g.unpriced ? ' *' : '') : '—', ''])
    for (const r of g.rows) {
      body.push([r.name, r.where, fmtQty(r.qty), r.unit,
        r.lastRate == null ? '—' : formatINR(r.lastRate),
        r.value == null ? '—' : formatINR(r.value),
        when(r.lastMovedAt)])
    }
  }

  autoTable(doc, {
    startY: 68,
    head: [STOCK_HEADERS],
    body,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 3, overflow: 'linebreak', textColor: [30, 35, 45] },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: [252, 252, 253] },
    columnStyles: {
      0: { cellWidth: 250 }, 1: { cellWidth: 150 },
      2: { halign: 'right', cellWidth: 60 }, 3: { cellWidth: 40 },
      4: { halign: 'right', cellWidth: 60 }, 5: { halign: 'right', cellWidth: 74 },
      6: { cellWidth: 62 },
    },
    didParseCell: (d) => {
      const raw = d.row.raw as unknown as Array<string> | undefined
      const first = String(raw?.[0] ?? '')
      if (first.startsWith('__GROUP__')) {
        d.cell.styles.fillColor = PAPER
        d.cell.styles.fontStyle = 'bold'
        d.cell.styles.fontSize = 8
        if (d.column.index === 0) d.cell.text = [first.replace('__GROUP__', '')]
      }
    },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight()
      doc.setFontSize(7).setTextColor(130)
      doc.text(`CT Hub · Material In & Out · printed ${stamp()}`, 32, h - 16)
      doc.text(`Page ${doc.getNumberOfPages()}`, W - 32, h - 16, { align: 'right' })
    },
  })

  const y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 68) + 14
  doc.setFillColor(...NAVY)
  doc.rect(32, y - 11, W - 64, 20, 'F')
  doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(9)
  doc.text(`TOTAL — ${spec.grand.items} items · ${spec.grand.lines} lines`, 40, y + 2)
  doc.text(spec.grand.value > 0 ? formatINR(spec.grand.value) : '—', W - 40, y + 2, { align: 'right' })

  if (spec.grand.unpriced) {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(150, 80, 20)
    doc.text('* The ₹ total is understated — some lines have no known rate. Odoo carried none.',
      32, y + 24)
  }
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(130)
  doc.text('Folded from every movement in the register — the same figure the screen shows.',
    32, y + (spec.grand.unpriced ? 36 : 24))

  doc.save(fileName(spec.title, 'pdf'))
}
