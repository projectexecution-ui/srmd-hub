// Client-side "Item Catalogue" generator — the material master as a shareable
// document. Two formats from one data set:
//   • PDF  — an industry-standard catalogue: header + KPIs, then items grouped
//            Category → Sub-category, each row carrying a thumbnail (the real
//            photo when the item has one, else a deterministic monogram), code,
//            name, short description, unit and stock-in-hand.
//   • Excel — the same data as a flat stock register for filtering/pivoting.
//
// Quantities use Indian grouping (standard-formatting rule). No money here, so
// jsPDF's missing-₹ glyph is a non-issue.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'

// Minimal structural shape of the didDrawCell payload we use — a subset of
// jspdf-autotable's CellHookData, so we don't depend on its type export.
interface DrawCell {
  section: string
  column: { index: number }
  row: { index: number }
  cell: { x: number; y: number; width: number; height: number }
}

export interface CatalogueRow {
  code: string
  name: string
  description: string | null
  unit: string
  category: string | null
  subcategory: string | null
  hsn_code: string | null
  image_url: string | null
  in_hand: number
}

export interface CatalogueMeta {
  orgLabel?: string          // e.g. "SRMD Construction"
  generatedAtLabel: string   // pre-formatted IST timestamp
  scopeLabel?: string        // e.g. "All stores" or a warehouse name
}

const nf = (n: number) => Number(n || 0).toLocaleString('en-IN')

// Deterministic monogram palette (bg tint + darker text from the same family).
const MONO: Array<[number, number, number, number, number, number]> = [
  [219, 234, 254, 30, 64, 175],   // blue
  [220, 252, 231, 22, 101, 52],   // green
  [254, 240, 199, 133, 79, 11],   // amber
  [251, 226, 232, 159, 18, 57],   // pink
  [237, 233, 254, 76, 29, 149],   // violet
  [204, 251, 241, 15, 118, 110],  // teal
  [255, 228, 216, 154, 52, 18],   // coral
  [226, 232, 240, 51, 65, 85],    // slate
]
function monoFor(key: string): [number, number, number, number, number, number] {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return MONO[h % MONO.length]
}
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function groupRows(rows: CatalogueRow[]) {
  const byCat = new Map<string, CatalogueRow[]>()
  for (const r of rows) {
    const k = r.category?.trim() || 'Uncategorised'
    if (!byCat.has(k)) byCat.set(k, [])
    byCat.get(k)!.push(r)
  }
  return [...byCat.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, items]) => ({
      category,
      items: items.slice().sort((a, b) =>
        (a.subcategory || '~').localeCompare(b.subcategory || '~') ||
        a.code.localeCompare(b.code)),
    }))
}

// imageData: url → dataURL (JPEG/PNG). Preloaded by the caller (browser-only).
export function buildCataloguePdf(
  rows: CatalogueRow[],
  meta: CatalogueMeta,
  imageData: Record<string, string> = {},
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4', unit: 'pt' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 36
  let y = 44

  // ── Header ──────────────────────────────────────────────
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(17, 24, 39)
  doc.text('Material catalogue', marginX, y)
  y += 16
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(107, 114, 128)
  const sub = [meta.orgLabel, meta.scopeLabel || 'All stores'].filter(Boolean).join('  ·  ')
  doc.text(sub, marginX, y)
  const stamp = `Generated ${meta.generatedAtLabel}`
  doc.text(stamp, pageW - marginX - doc.getTextWidth(stamp), y)
  y += 18

  // ── KPI strip ───────────────────────────────────────────
  const groups = groupRows(rows)
  const stocked = rows.filter(r => r.in_hand > 0).length
  const kpis = [
    { label: 'Items', value: nf(rows.length) },
    { label: 'Categories', value: nf(groups.length) },
    { label: 'In stock', value: nf(stocked) },
    { label: 'Out of stock', value: nf(rows.length - stocked) },
  ]
  const gap = 10
  const cardW = (pageW - marginX * 2 - gap * (kpis.length - 1)) / kpis.length
  kpis.forEach((k, i) => {
    const x = marginX + i * (cardW + gap)
    doc.setDrawColor(229, 231, 235); doc.setFillColor(249, 250, 251)
    doc.roundedRect(x, y, cardW, 40, 5, 5, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 114, 128)
    doc.text(k.label.toUpperCase(), x + 8, y + 14)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(17, 24, 39)
    doc.text(k.value, x + 8, y + 32)
  })
  y += 40 + 18

  const IMG = 26 // thumbnail box (pt)

  for (const g of groups) {
    if (y > pageH - 120) { doc.addPage(); y = 44 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30, 64, 175)
    doc.text(`${g.category}  (${nf(g.items.length)})`, marginX, y)
    y += 6

    autoTable(doc, {
      startY: y + 4,
      head: [['', 'Code', 'Item', 'Sub-category', 'Description', 'Unit', 'In hand']],
      body: g.items.map(r => [
        '', // thumbnail drawn in didDrawCell
        r.code,
        r.name,
        r.subcategory || '—',
        r.description || '',
        r.unit,
        nf(r.in_hand),
      ]),
      margin: { left: marginX, right: marginX },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3, textColor: [31, 41, 55], valign: 'middle', minCellHeight: IMG + 4 },
      headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontSize: 7.5, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 249] },
      columnStyles: {
        0: { cellWidth: IMG + 8, halign: 'center' },
        1: { cellWidth: 58, font: 'courier', fontSize: 7.5 },
        2: { cellWidth: 132 },
        3: { cellWidth: 74 },
        4: { cellWidth: 'auto', textColor: [107, 114, 128], fontSize: 7.5 },
        5: { cellWidth: 30, halign: 'center' },
        6: { cellWidth: 46, halign: 'right', fontStyle: 'bold' },
      },
      didDrawCell: (data: DrawCell) => {
        if (data.section !== 'body' || data.column.index !== 0) return
        const r = g.items[data.row.index]
        if (!r) return
        const size = IMG
        const cx = data.cell.x + (data.cell.width - size) / 2
        const cy = data.cell.y + (data.cell.height - size) / 2
        const dataUrl = r.image_url ? imageData[r.image_url] : undefined
        if (dataUrl) {
          try {
            const fmt = dataUrl.includes('image/png') ? 'PNG' : 'JPEG'
            doc.addImage(dataUrl, fmt, cx, cy, size, size)
            return
          } catch { /* fall through to monogram */ }
        }
        const [br, bg, bb, tr, tg, tb] = monoFor(r.category || r.name)
        doc.setFillColor(br, bg, bb)
        doc.roundedRect(cx, cy, size, size, 4, 4, 'F')
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(tr, tg, tb)
        doc.text(initials(r.name), cx + size / 2, cy + size / 2 + 3, { align: 'center' })
      },
    })
    // @ts-expect-error autoTable attaches lastAutoTable on the doc at runtime.
    y = (doc.lastAutoTable?.finalY ?? y) + 18
  }

  // ── Footer ──────────────────────────────────────────────
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(156, 163, 175)
    const foot = `CT HUB · Inventory catalogue · page ${p} of ${pages}`
    doc.text(foot, marginX, pageH - 18)
  }
  return doc
}

export function buildCatalogueExcel(rows: CatalogueRow[], meta: CatalogueMeta): XLSX.WorkBook {
  const grouped = groupRows(rows).flatMap(g => g.items)
  const aoa: (string | number)[][] = [
    ['Material catalogue', meta.orgLabel || '', '', '', `Generated ${meta.generatedAtLabel}`],
    [],
    ['Code', 'Category', 'Sub-category', 'Item name', 'Short description', 'Unit', 'HSN', 'In hand'],
    ...grouped.map(r => [
      r.code,
      r.category || '',
      r.subcategory || '',
      r.name,
      r.description || '',
      r.unit,
      r.hsn_code || '',
      Number(r.in_hand || 0),
    ]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 34 }, { wch: 40 }, { wch: 8 }, { wch: 12 }, { wch: 10 },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Catalogue')
  return wb
}
