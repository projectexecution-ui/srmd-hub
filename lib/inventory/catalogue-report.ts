// Client-side "Item Catalogue" generator — the material master as a document
// management can read cover-to-cover. One data set, two formats:
//   • PDF  — a bound register: a navy/gold masthead, a one-page STOCK SUMMARY
//            (per-store stock, a by-category count with low/out, and a short
//            watch-list of what's run out or low), a CONTENTS page with PDF
//            bookmarks, then the compact REGISTER grouped by category:
//            Code · Item · In-hand (qty + unit) · Where it is (per store).
//            An optional photo column embeds the item picture (monogram if none).
//   • Excel — the same rows flat, plus per-store columns, for filtering/pivoting.
//
// Quantities use Indian grouping (standard-formatting rule). No money here, so
// jsPDF's missing-₹ glyph is a non-issue.
import { jsPDF } from 'jspdf'
import autoTable, { type CellHookData } from 'jspdf-autotable'
import * as XLSX from 'xlsx'

export interface StoreQty {
  code: string     // warehouse code (stable key)
  label: string    // short, human store name e.g. "Yunus", "Central"
  qty: number      // physical qty of this item in this store
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
  in_hand: number          // physical qty summed across the stores below
  stores: StoreQty[]       // only stores that actually hold this item (qty > 0)
  low: boolean             // stocked but at/under its reorder threshold
  out: boolean             // nothing on hand
}

export interface WarehouseInfo {
  code: string
  label: string            // short store name
}

export interface CatalogueMeta {
  orgLabel?: string          // e.g. "SRMD Construction"
  generatedAtLabel: string   // pre-formatted IST timestamp
  scopeLabel?: string        // e.g. "All stores" or a single store name
  warehouses?: WarehouseInfo[] // every store, so the summary can show empties too
}

const nf = (n: number) => Number(n || 0).toLocaleString('en-IN')

// Brand palette (RGB tuples for jsPDF).
const NAVY: [number, number, number] = [15, 42, 74]
const NAVY_SOFT: [number, number, number] = [30, 64, 105]
const GOLD: [number, number, number] = [200, 162, 74]
const INK: [number, number, number] = [31, 41, 55]
const MUTE: [number, number, number] = [107, 114, 128]
const AMBER: [number, number, number] = [180, 83, 9]
const ROSE: [number, number, number] = [190, 24, 60]

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

// "472 Nos" — qty with its unit inline (the user asked for units next to numbers).
function qtyUnit(n: number, unit: string): string {
  return `${nf(n)}${unit ? ' ' + unit : ''}`
}
// "Yunus 472" or "Yunus 400 · Central 72" — the per-store distribution.
function whereText(stores: StoreQty[]): string {
  if (!stores.length) return '—'
  return stores
    .slice().sort((a, b) => b.qty - a.qty)
    .map(s => `${s.label} ${nf(s.qty)}`)
    .join('  ·  ')
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

function drawFooter(doc: jsPDF, pageW: number, pageH: number, marginX: number) {
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE)
    doc.text('CT HUB · Inventory catalogue', marginX, pageH - 18)
    const rt = `Page ${p} of ${pages}`
    doc.text(rt, pageW - marginX - doc.getTextWidth(rt), pageH - 18)
  }
}

// imageData: url → dataURL (JPEG/PNG). Preloaded by the caller (browser-only).
export function buildCataloguePdf(
  rows: CatalogueRow[],
  meta: CatalogueMeta,
  imageData: Record<string, string> = {},
  opts: { photos?: boolean } = {},
): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', format: 'a4', unit: 'pt' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const marginX = 36
  const contentW = pageW - marginX * 2
  const withPhotos = !!opts.photos
  const groups = groupRows(rows)

  // ─────────────────────────────────────────────────────────────
  // PAGE 1 — masthead + stock summary
  // ─────────────────────────────────────────────────────────────
  // Masthead band.
  doc.setFillColor(...NAVY); doc.rect(0, 0, pageW, 84, 'F')
  doc.setFillColor(...GOLD); doc.rect(0, 84, pageW, 3, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(255, 255, 255)
  doc.text('Material Catalogue', marginX, 40)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(206, 214, 224)
  const sub = [meta.orgLabel, meta.scopeLabel || 'All stores'].filter(Boolean).join('   ·   ')
  doc.text(sub, marginX, 58)
  const stamp = `Generated ${meta.generatedAtLabel}`
  doc.setFontSize(8.5)
  doc.text(stamp, pageW - marginX - doc.getTextWidth(stamp), 58)
  const totalTag = `${nf(rows.length)} items  ·  ${nf(groups.length)} categories`
  doc.setTextColor(...GOLD); doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text(totalTag, marginX, 74)

  let y = 84 + 3 + 26

  // Headline KPIs.
  const stocked = rows.filter(r => r.in_hand > 0).length
  const lowN = rows.filter(r => r.low).length
  const outN = rows.filter(r => r.out).length
  const kpis = [
    { label: 'Items', value: nf(rows.length), tone: INK },
    { label: 'In stock', value: nf(stocked), tone: [22, 101, 52] as [number, number, number] },
    { label: 'Low stock', value: nf(lowN), tone: AMBER },
    { label: 'Out of stock', value: nf(outN), tone: ROSE },
  ]
  const gap = 10
  const cardW = (contentW - gap * (kpis.length - 1)) / kpis.length
  kpis.forEach((k, i) => {
    const x = marginX + i * (cardW + gap)
    doc.setDrawColor(229, 231, 235); doc.setFillColor(249, 250, 251)
    doc.roundedRect(x, y, cardW, 46, 5, 5, 'FD')
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTE)
    doc.text(k.label.toUpperCase(), x + 9, y + 15)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...k.tone)
    doc.text(k.value, x + 9, y + 37)
  })
  y += 46 + 22

  // Per-store stock (where the material actually sits).
  const storeList = meta.warehouses && meta.warehouses.length
    ? meta.warehouses
    : uniqueStores(rows)
  const perStore = new Map<string, { items: number; qty: number }>()
  for (const s of storeList) perStore.set(s.code, { items: 0, qty: 0 })
  for (const r of rows) {
    for (const s of r.stores) {
      if (s.qty <= 0) continue
      const cur = perStore.get(s.code) ?? { items: 0, qty: 0 }
      cur.items += 1; cur.qty += s.qty
      perStore.set(s.code, cur)
    }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY)
  doc.text('Where the stock sits', marginX, y)
  y += 10
  const tiles = storeList.map(s => ({ s, v: perStore.get(s.code) ?? { items: 0, qty: 0 } }))
  const perRow = Math.min(tiles.length || 1, 5)
  const tGap = 10
  const tileW = (contentW - tGap * (perRow - 1)) / perRow
  tiles.forEach((t, i) => {
    const col = i % perRow, rowIdx = Math.floor(i / perRow)
    const x = marginX + col * (tileW + tGap)
    const ty = y + 8 + rowIdx * (52 + tGap)
    const empty = t.v.items === 0
    const border: [number, number, number] = empty ? [229, 231, 235] : GOLD
    const fill: [number, number, number] = empty ? [249, 250, 251] : [253, 250, 242]
    doc.setDrawColor(...border)
    doc.setFillColor(...fill)
    doc.roundedRect(x, ty, tileW, 52, 5, 5, 'FD')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...NAVY)
    doc.text(clip(doc, t.s.label, tileW - 16), x + 8, ty + 15)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...(empty ? MUTE : INK))
    doc.text(nf(t.v.items), x + 8, ty + 36)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTE)
    doc.text('items stocked', x + 8, ty + 46)
  })
  const tileRows = Math.ceil(tiles.length / perRow)
  y += 8 + tileRows * (52 + tGap) + 12

  // By-category counts with low / out.
  const catStats = groups.map(g => ({
    category: g.category,
    items: g.items.length,
    low: g.items.filter(r => r.low).length,
    out: g.items.filter(r => r.out).length,
  }))
  autoTable(doc, {
    startY: y,
    head: [['Category', 'Items', 'Low', 'Out']],
    body: catStats.map(c => [c.category, nf(c.items), c.low ? nf(c.low) : '—', c.out ? nf(c.out) : '—']),
    foot: [['Total', nf(rows.length), lowN ? nf(lowN) : '—', outN ? nf(outN) : '—']],
    margin: { left: marginX, right: marginX },
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 4, textColor: INK },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
    footStyles: { fillColor: [243, 244, 246], textColor: NAVY, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 250, 249] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 70, halign: 'right' },
      2: { cellWidth: 60, halign: 'right', textColor: AMBER },
      3: { cellWidth: 60, halign: 'right', textColor: ROSE },
    },
    didParseCell: (d: CellHookData) => {
      // Grey the em-dash zeros so real low/out counts pop.
      if (d.section === 'body' && (d.column.index === 2 || d.column.index === 3) && d.cell.text[0] === '—') {
        d.cell.styles.textColor = [209, 213, 219]
      }
    },
  })
  // @ts-expect-error autoTable attaches lastAutoTable at runtime.
  y = (doc.lastAutoTable?.finalY ?? y) + 18

  // Watch-list: out first, then low. Short, actionable.
  const watch = rows
    .filter(r => r.out || r.low)
    .sort((a, b) => Number(b.out) - Number(a.out) || a.name.localeCompare(b.name))
    .slice(0, 12)
  if (watch.length) {
    if (y > pageH - 120) { doc.addPage(); y = 44 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY)
    doc.text('Needs attention', marginX, y)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTE)
    doc.text('Out of stock and low-stock items — chase these first.', marginX + 108, y)
    y += 6
    autoTable(doc, {
      startY: y + 4,
      head: [['Code', 'Item', 'Category', 'In hand', 'Status']],
      body: watch.map(r => [
        r.code, r.name, r.category || '—',
        qtyUnit(r.in_hand, r.unit),
        r.out ? 'OUT OF STOCK' : 'LOW',
      ]),
      margin: { left: marginX, right: marginX },
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 3.5, textColor: INK },
      headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontSize: 7.5, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 62, font: 'courier', fontSize: 7.5 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 96, textColor: MUTE },
        3: { cellWidth: 62, halign: 'right' },
        4: { cellWidth: 82, halign: 'center', fontStyle: 'bold', fontSize: 7.5 },
      },
      didParseCell: (d: CellHookData) => {
        if (d.section === 'body' && d.column.index === 4) {
          d.cell.styles.textColor = watch[d.row.index].out ? ROSE : AMBER
        }
      },
    })
    // @ts-expect-error runtime.
    y = (doc.lastAutoTable?.finalY ?? y) + 12
  }

  // ─────────────────────────────────────────────────────────────
  // PAGE 2 — contents (filled in AFTER the register, once we know page numbers)
  // ─────────────────────────────────────────────────────────────
  doc.addPage()
  const contentsPage = doc.getCurrentPageInfo().pageNumber

  // ─────────────────────────────────────────────────────────────
  // PAGE 3+ — the register, category by category
  // ─────────────────────────────────────────────────────────────
  doc.addPage()
  const topY = 44
  y = topY
  const contents: Array<{ category: string; page: number; count: number }> = []
  const IMG = 24

  for (const g of groups) {
    if (y > pageH - 90) { doc.addPage(); y = topY }
    const startPage = doc.getCurrentPageInfo().pageNumber
    contents.push({ category: g.category, page: startPage, count: g.items.length })

    // Category band.
    doc.setFillColor(...NAVY_SOFT)
    doc.roundedRect(marginX, y - 2, contentW, 20, 3, 3, 'F')
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(255, 255, 255)
    doc.text(g.category, marginX + 8, y + 11.5)
    const cnt = `${nf(g.items.length)} items`
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...GOLD)
    doc.text(cnt, pageW - marginX - 8 - doc.getTextWidth(cnt), y + 11.5)
    y += 22

    const head = withPhotos
      ? ['', 'Code', 'Item', 'In hand', 'Where it is']
      : ['Code', 'Item', 'In hand', 'Where it is']
    const body = g.items.map(r => {
      const base = [r.code, r.name, qtyUnit(r.in_hand, r.unit), whereText(r.stores)]
      return withPhotos ? ['', ...base] : base
    })
    const colStyles: Record<number, object> = withPhotos
      ? {
          0: { cellWidth: IMG + 8, halign: 'center' },
          1: { cellWidth: 60, font: 'courier', fontSize: 7.5 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 66, halign: 'right', fontStyle: 'bold' },
          4: { cellWidth: 150, textColor: MUTE, fontSize: 7.5 },
        }
      : {
          0: { cellWidth: 66, font: 'courier', fontSize: 7.5 },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 70, halign: 'right', fontStyle: 'bold' },
          3: { cellWidth: 168, textColor: MUTE, fontSize: 7.5 },
        }

    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      margin: { left: marginX, right: marginX, top: topY },
      // NB: only set minCellHeight when photos are on — passing `undefined`
      // explicitly overrides autoTable's default and breaks row pagination.
      styles: {
        font: 'helvetica', fontSize: 8, cellPadding: withPhotos ? 3 : 2.6,
        textColor: INK, valign: 'middle',
        ...(withPhotos ? { minCellHeight: IMG + 4 } : {}),
      },
      headStyles: { fillColor: [243, 244, 246], textColor: [55, 65, 81], fontSize: 7.5, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 249] },
      columnStyles: colStyles,
      didParseCell: (d: CellHookData) => {
        // Colour the in-hand qty for low/out rows in the compact (no-photo) layout.
        const qtyCol = withPhotos ? 3 : 2
        if (d.section === 'body' && d.column.index === qtyCol) {
          const r = g.items[d.row.index]
          if (r?.out) d.cell.styles.textColor = ROSE
          else if (r?.low) d.cell.styles.textColor = AMBER
        }
      },
      didDrawCell: withPhotos ? (data: CellHookData) => {
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
      } : undefined,
    })
    // @ts-expect-error runtime.
    y = (doc.lastAutoTable?.finalY ?? y) + 16
  }

  // ── Fill the contents page now that page numbers are known ──
  doc.setPage(contentsPage)
  let cy = 48
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...NAVY)
  doc.text('Contents', marginX, cy)
  cy += 8
  doc.setDrawColor(...GOLD); doc.setLineWidth(1.5)
  doc.line(marginX, cy, marginX + 44, cy)
  doc.setLineWidth(0.2)
  cy += 20
  doc.setFontSize(9)
  for (const c of contents) {
    if (cy > pageH - 60) break // contents stays a single page by design
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK)
    const left = c.category
    const right = `${nf(c.count)} · p.${c.page}`
    doc.text(left, marginX, cy)
    doc.setTextColor(...MUTE)
    doc.text(right, pageW - marginX - doc.getTextWidth(right), cy)
    // leader dots
    doc.setTextColor(209, 213, 219)
    const dotsStart = marginX + doc.getTextWidth(left) + 6
    const dotsEnd = pageW - marginX - doc.getTextWidth(right) - 6
    if (dotsEnd > dotsStart) {
      const dots = '.'.repeat(Math.max(0, Math.floor((dotsEnd - dotsStart) / doc.getTextWidth('.'))))
      doc.text(dots, dotsStart, cy)
    }
    cy += 16
  }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...MUTE)
  doc.text('Tip: use the PDF bookmarks panel to jump straight to any category.', marginX, pageH - 40)

  // PDF outline / bookmarks — best-effort (jsPDF outline API).
  try {
    const outline = (doc as unknown as {
      outline?: { add: (parent: unknown, title: string, options: { pageNumber: number }) => void }
    }).outline
    if (outline?.add) {
      for (const c of contents) outline.add(null, c.category, { pageNumber: c.page })
    }
  } catch { /* bookmarks are a nicety, never fatal */ }

  drawFooter(doc, pageW, pageH, marginX)
  return doc
}

function uniqueStores(rows: CatalogueRow[]): WarehouseInfo[] {
  const m = new Map<string, string>()
  for (const r of rows) for (const s of r.stores) if (!m.has(s.code)) m.set(s.code, s.label)
  return [...m.entries()].map(([code, label]) => ({ code, label }))
}

// Truncate to fit a pixel width, appending an ellipsis.
function clip(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text
  let t = text
  while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1)
  return t + '…'
}

export function buildCatalogueExcel(rows: CatalogueRow[], meta: CatalogueMeta): XLSX.WorkBook {
  const stores = meta.warehouses && meta.warehouses.length ? meta.warehouses : uniqueStores(rows)
  const grouped = groupRows(rows).flatMap(g => g.items)
  const storeHeaders = stores.map(s => s.label)
  const aoa: (string | number)[][] = [
    ['Material catalogue', meta.orgLabel || '', '', '', `Generated ${meta.generatedAtLabel}`],
    [],
    ['Code', 'Category', 'Sub-category', 'Item name', 'Short description', 'Unit', 'HSN', 'In hand', 'Status', ...storeHeaders],
    ...grouped.map(r => {
      const byStore = new Map(r.stores.map(s => [s.code, s.qty]))
      return [
        r.code,
        r.category || '',
        r.subcategory || '',
        r.name,
        r.description || '',
        r.unit,
        r.hsn_code || '',
        Number(r.in_hand || 0),
        r.out ? 'Out of stock' : r.low ? 'Low' : 'OK',
        ...stores.map(s => Number(byStore.get(s.code) || 0)),
      ]
    }),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [
    { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 34 }, { wch: 40 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 12 },
    ...stores.map(() => ({ wch: 12 })),
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Catalogue')
  return wb
}
