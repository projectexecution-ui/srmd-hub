// Server-side PDF versions of the 3 weekly Budget vs Actual reports, so the
// weekly cron can attach them to Telegram (sendDocument). They mirror the
// on-screen print pages (weekly-client.tsx / weekly-detail-client.tsx) — same
// columns, grouping, ₹/sft and week-over-week Δ — but rendered with jsPDF so
// there are real PDF bytes without a browser. Fed by the SAME loadBudgetV2
// result, so the numbers can never drift from the tree/print pages.
//
//   buildWeeklyOnePagerPdf   → portfolio one-pager (one line per project)
//   buildWeeklyDetailPdf(…,'category')     → summary + one project/page by category
//   buildWeeklyDetailPdf(…,'subcategory')  → same, categories expanded to work-items

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ComposeResult, CatNode, SubCatNode, DeltaResult } from '@/lib/budget-v2'
import type { BudgetV2Freshness } from '@/lib/budget-v2-load'

// Embed Noto Sans (already bundled for the Telegram cards) so ₹ + Indian digit
// grouping render — jsPDF's built-in Helvetica has no ₹ glyph.
const FONT_PATH = join(process.cwd(), 'lib', 'bills-pipeline', 'fonts', 'NotoSans.ttf')
let FONT_B64: string | null = null
function useFont(doc: jsPDF) {
  if (!existsSync(FONT_PATH)) return
  if (FONT_B64 == null) FONT_B64 = readFileSync(FONT_PATH).toString('base64')
  doc.addFileToVFS('NotoSans.ttf', FONT_B64)
  doc.addFont('NotoSans.ttf', 'Noto', 'normal')
  doc.addFont('NotoSans.ttf', 'Noto', 'bold') // same file (no bold weight) — emphasis via fills/size
  doc.setFont('Noto', 'normal')
}

type RGB = [number, number, number]
const C = {
  navy: [15, 42, 74] as RGB, gold: [184, 134, 59] as RGB, ink: [17, 24, 39] as RGB,
  mut: [107, 114, 128] as RGB, faint: [156, 163, 175] as RGB, line: [229, 231, 235] as RGB,
  appr: [13, 68, 124] as RGB, ok: [31, 111, 61] as RGB, warn: [138, 90, 11] as RGB, over: [163, 40, 45] as RGB,
  up: [22, 101, 52] as RGB, down: [154, 52, 18] as RGB,
  grpBg: [238, 242, 247] as RGB, totalBg: [226, 232, 242] as RGB, headBg: [248, 250, 252] as RGB,
  catBg: [237, 240, 245] as RGB, subBg: [247, 249, 251] as RGB, subInk: [75, 85, 99] as RGB,
  openBg: [234, 243, 222] as RGB, openInk: [39, 80, 10] as RGB, closedBg: [241, 239, 232] as RGB, closedInk: [68, 68, 65] as RGB,
}

function fmtINR(v: number): string {
  if (!isFinite(v) || v === 0) return '₹0'
  const a = Math.abs(v), s = v < 0 ? '-' : ''
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`
  return `${s}₹${Math.round(a).toLocaleString('en-IN')}/-`
}
function fmtDelta(v: number): string { return v === 0 ? '—' : (v > 0 ? '+' : '-') + fmtINR(Math.abs(v)) }
function perSft(amt: number, area: number | null | undefined): string {
  if (!area || area <= 0 || !amt) return ''
  return `₹${Math.round(amt / area).toLocaleString('en-IN')}/sft`
}
function pct(p: number, b: number): number | null { return b > 0 ? Math.round((p / b) * 100) : null }
function toneColor(u: number | null): RGB | undefined { return u == null ? undefined : u > 100 ? C.over : u >= 85 ? C.warn : C.ok }
function asOf(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso.length === 10 ? iso + 'T00:00:00' : iso); if (!isFinite(t)) return '—'
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}
function nowIST(): string {
  return new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
}

interface Cell { t: string; sub?: string; color?: RGB }
type RowType = 'grp' | 'proj' | 'total' | 'cat' | 'sub'
interface Row { type: RowType; cols: Cell[] }

const money = (v: number, color?: RGB, sub?: string): Cell => ({ t: fmtINR(v), color, sub })
function deltaCell(v: number | null): Cell {
  if (v == null) return { t: '—', color: C.faint }
  return { t: fmtDelta(v), color: v === 0 ? C.faint : v > 0 ? C.up : C.down }
}

// Shared table renderer: builds an autoTable with per-row-type fills, per-cell
// text colours, and the small grey ₹/sft sub-line under money cells. Returns
// the finalY so the caller can place a footer.
function renderRows(doc: jsPDF, rows: Row[], head: string[], startY: number, M: number): number {
  autoTable(doc, {
    startY,
    margin: { left: M, right: M },
    head: [head],
    body: rows.map(r => r.cols.map(c => c.t)),
    theme: 'plain',
    styles: { font: 'Noto', fontStyle: 'normal', fontSize: 8, cellPadding: { top: 3, bottom: 3, left: 6, right: 6 }, textColor: C.ink, lineColor: [241, 243, 245], lineWidth: { bottom: 0.5 }, overflow: 'linebreak' },
    headStyles: { fillColor: C.headBg, textColor: C.faint, fontSize: 6.8, halign: 'right', cellPadding: { top: 5, bottom: 5, left: 6, right: 6 } },
    columnStyles: { 0: { halign: 'left', cellWidth: 'auto' }, 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right', cellWidth: 34 }, 6: { halign: 'right' } },
    didParseCell: (d) => {
      if (d.section === 'head') { if (d.column.index === 0) d.cell.styles.halign = 'left'; return }
      if (d.section !== 'body') return
      const r = rows[d.row.index]; const cell = r.cols[d.column.index]
      if (cell.color) d.cell.styles.textColor = cell.color
      if (r.type === 'grp') { d.cell.styles.fillColor = C.grpBg; if (d.column.index === 0) d.cell.styles.textColor = C.navy }
      else if (r.type === 'total') { d.cell.styles.fillColor = C.totalBg; if (d.column.index === 0) d.cell.styles.textColor = C.navy }
      else if (r.type === 'cat') { d.cell.styles.fillColor = C.catBg }
      else if (r.type === 'sub') { if (!cell.color) d.cell.styles.textColor = C.subInk; d.cell.styles.fillColor = C.subBg; d.cell.styles.fontSize = 7.5 }
      // indent the left label column by row depth
      if (d.column.index === 0) {
        const pad = r.type === 'proj' ? 18 : r.type === 'sub' ? 24 : 6
        d.cell.styles.cellPadding = { top: 3, bottom: 3, left: pad, right: 6 }
      }
      if (r.type !== 'grp' && cell.sub) d.cell.styles.minCellHeight = 20
    },
    didDrawCell: (d) => {
      if (d.section !== 'body') return
      const r = rows[d.row.index]; const cell = r.cols[d.column.index]
      if (r.type !== 'grp' && cell.sub) {
        doc.setFont('Noto', 'normal'); doc.setFontSize(5.6); doc.setTextColor(...C.faint)
        doc.text(cell.sub, d.cell.x + d.cell.width - 6, d.cell.y + d.cell.height - 4.5, { align: 'right' })
      }
    },
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (doc as any).lastAutoTable?.finalY ?? startY
}

function footer(doc: jsPDF, M: number, y: number, left: string): void {
  const W = doc.internal.pageSize.getWidth()
  doc.setFont('Noto', 'normal'); doc.setFontSize(7); doc.setTextColor(...C.faint)
  doc.text(left, M, y)
  doc.text(`Generated ${nowIST()}`, W - M, y, { align: 'right' })
}

const HEAD_MONEY = ['Budget', 'WO/PO Appr.', 'Paid', 'Balance', 'Used', 'Δ Paid (wk)']

export interface WeeklyPdfInput {
  result: ComposeResult
  freshness: BudgetV2Freshness
  delta: DeltaResult
  prevSnapshotWeek: string | null
}
export interface WeeklyDetailInput extends WeeklyPdfInput { prev: ComposeResult | null }

function displayGroups(result: ComposeResult) {
  return result.groups.map(g => ({ ...g, name: g.name === '— Ungrouped' ? 'Standalone projects' : g.name }))
}

// ── Report 1: the one-pager ──────────────────────────────────────────────────
export function buildWeeklyOnePagerPdf(input: WeeklyPdfInput): Uint8Array {
  const { result, freshness, delta, prevSnapshotWeek } = input
  const t = result.totals
  const balance = t.budget - t.spent
  const usedPct = pct(t.spent, t.budget) ?? 0
  const groups = displayGroups(result)
  const nProjects = groups.reduce((s, g) => s + g.projects.length, 0)

  const doc = new jsPDF({ orientation: 'portrait', format: 'a4', unit: 'pt', compress: true })
  useFont(doc)
  const W = doc.internal.pageSize.getWidth(); const M = 34

  // Header
  doc.setFontSize(9); doc.setTextColor(...C.gold); doc.text('SRMD · CONSTRUCTION', M, 40)
  doc.setFontSize(17); doc.setTextColor(...C.ink); doc.text('Weekly Budget vs Actual', M, 60)
  doc.setFontSize(9); doc.setTextColor(...C.mut)
  doc.text(`As on ${asOf(freshness.budget)}  ·  from CT HUB  ·  confidential — management`, M, 75)
  const badge = `${nProjects} projects`; doc.setFontSize(9)
  const bw = doc.getTextWidth(badge) + 16
  doc.setFillColor(230, 240, 250); doc.roundedRect(W - M - bw, 30, bw, 18, 9, 9, 'F')
  doc.setTextColor(...C.appr); doc.text(badge, W - M - bw + 8, 42)
  doc.setDrawColor(...C.navy); doc.setLineWidth(1.2); doc.line(M, 84, W - M, 84)

  // KPI strip
  const ky = 96, kh = 52, kw = (W - M * 2) / 4
  const kpis = [
    { l: 'TOTAL BUDGET', n: fmtINR(t.budget) as string, nColor: undefined as RGB | undefined, d: '' },
    { l: 'PAID TO DATE', n: fmtINR(t.spent), nColor: C.ok, d: `${usedPct}% of budget${t.area > 0 ? ` · avg ${perSft(t.spent, t.area)}` : ''}` },
    { l: balance < 0 ? 'OVER BUDGET' : 'BALANCE LEFT', n: fmtINR(Math.abs(balance)), nColor: balance < 0 ? C.over : undefined, d: '' },
    { l: 'PAID THIS WEEK', n: delta.hasBaseline ? fmtDelta(delta.overall.paid) : '— first upload', nColor: delta.hasBaseline ? (delta.overall.paid >= 0 ? C.up : C.down) : C.faint, d: delta.hasBaseline ? `vs upload of ${asOf(prevSnapshotWeek)}` : 'no earlier upload' },
  ]
  doc.setDrawColor(...C.line); doc.setLineWidth(0.6)
  kpis.forEach((k, i) => {
    const x = M + i * kw
    if (i > 0) doc.line(x, ky, x, ky + kh)
    doc.setFontSize(7.5); doc.setTextColor(...C.faint); doc.text(k.l, x + 8, ky + 12)
    doc.setFontSize(13); doc.setTextColor(...(k.nColor ?? C.ink)); doc.text(k.n, x + 8, ky + 30)
    if (k.d) { doc.setFontSize(7.5); doc.setTextColor(...C.mut); doc.text(k.d, x + 8, ky + 44) }
  })
  doc.line(M, ky + kh, W - M, ky + kh)

  // Rows
  const rows: Row[] = []
  for (const g of groups) {
    const gu = pct(g.spent, g.budget)
    const gd = g.projects.reduce((s, p) => s + (delta.hasBaseline ? (delta.byProject[p.name]?.paid ?? 0) : 0), 0)
    rows.push({ type: 'grp', cols: [{ t: `${g.name} · ${g.projects.length}` }, money(g.budget), money(g.approved, C.appr), money(g.spent, toneColor(gu)), money(g.budget - g.spent, g.budget - g.spent < 0 ? C.over : undefined), { t: gu != null ? `${gu}%` : '—', color: toneColor(gu) }, delta.hasBaseline ? deltaCell(gd) : { t: '—', color: C.faint }] })
    for (const p of g.projects) {
      const u = pct(p.spent, p.budget)
      const dp = delta.hasBaseline ? (delta.byProject[p.name]?.paid ?? 0) : null
      const manual = !!(p.manual && (p.manual.budget || p.manual.approved || p.manual.spent))
      const name = `${p.name}${p.status === 'closed' ? ' · closed' : ''}${p.area ? ` · ${p.area.toLocaleString('en-IN')} sft` : ''}${manual ? (p.isExtra ? '  [manual]' : '  [adj]') : ''}`
      rows.push({ type: 'proj', cols: [{ t: name }, money(p.budget, undefined, perSft(p.budget, p.area)), money(p.approved, C.appr, perSft(p.approved, p.area)), money(p.spent, toneColor(u), perSft(p.spent, p.area)), money(p.budget - p.spent, p.budget - p.spent < 0 ? C.over : undefined, perSft(p.budget - p.spent, p.area)), { t: u != null ? `${u}%` : '—', color: toneColor(u) }, delta.hasBaseline ? deltaCell(dp) : { t: '—', color: C.faint }] })
    }
  }
  rows.push({ type: 'total', cols: [{ t: 'TOTAL' }, money(t.budget, undefined, perSft(t.budget, t.area)), money(t.approved, C.appr, perSft(t.approved, t.area)), money(t.spent, undefined, perSft(t.spent, t.area)), money(balance, balance < 0 ? C.over : undefined, perSft(balance, t.area)), { t: `${usedPct}%` }, delta.hasBaseline ? deltaCell(delta.overall.paid) : { t: '—', color: C.faint }] })

  let y = renderRows(doc, rows, ['Project', ...HEAD_MONEY], ky + kh + 10, M)
  if (!delta.hasBaseline) {
    y += 14
    doc.setFillColor(251, 240, 220); doc.setDrawColor(230, 207, 155)
    doc.roundedRect(M, y, W - M * 2, 28, 6, 6, 'FD')
    doc.setFontSize(8); doc.setTextColor(...C.warn)
    doc.text('First upload — the "Δ Paid (wk)" column fills in once a second budget report is uploaded.', M + 10, y + 17)
    y += 28
  }
  footer(doc, M, y + 22, 'CT HUB · Budget vs Actual · one line per project')
  return doc.output('arraybuffer') as unknown as Uint8Array
}

// ── Reports 2 & 3: detail, one project per page ──────────────────────────────
export function buildWeeklyDetailPdf(input: WeeklyDetailInput, mode: 'category' | 'subcategory'): Uint8Array {
  const { result, prev, delta, freshness, prevSnapshotWeek } = input
  const isSub = mode === 'subcategory'
  const t = result.totals
  const usedPct = pct(t.spent, t.budget) ?? 0
  const groups = displayGroups(result)
  const projects = groups.flatMap(g => g.projects.map(p => ({ p, group: g.name })))
  const showSummary = projects.length > 1
  const kind = isSub ? 'Sub-category' : 'Category'

  const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const prevProj = new Set<string>(); const prevCat = new Map<string, number>(); const prevSub = new Map<string, number>()
  if (prev) for (const g of prev.groups) for (const p of g.projects) {
    prevProj.add(p.name)
    for (const c of p.categories) { prevCat.set(p.name + '||' + norm(c.label), c.spent); for (const sc of c.subcats) prevSub.set(p.name + '||' + norm(c.label) + '||' + norm(sc.label), sc.spent) }
  }
  const catDelta = (proj: string, c: CatNode): number | null => prev && prevProj.has(proj) ? c.spent - (prevCat.get(proj + '||' + norm(c.label)) ?? 0) : null
  const subDelta = (proj: string, c: CatNode, sc: SubCatNode): number | null => prev && prevProj.has(proj) ? sc.spent - (prevSub.get(proj + '||' + norm(c.label) + '||' + norm(sc.label)) ?? 0) : null
  const projDelta = (name: string): number | null => delta.hasBaseline ? (delta.byProject[name]?.paid ?? 0) : null

  const doc = new jsPDF({ orientation: 'portrait', format: 'a4', unit: 'pt', compress: true })
  useFont(doc)
  const W = doc.internal.pageSize.getWidth(); const M = 32
  let first = true
  const page = () => { if (!first) doc.addPage(); first = false }

  // Summary page
  if (showSummary) {
    page()
    doc.setFontSize(9); doc.setTextColor(...C.gold); doc.text('SRMD · CONSTRUCTION', M, 40)
    doc.setFontSize(16); doc.setTextColor(...C.ink); doc.text(`Weekly Budget vs Actual — by ${kind}`, M, 60)
    doc.setFontSize(9); doc.setTextColor(...C.mut)
    doc.text(`Summary · as on ${asOf(freshness.budget)} · ${projects.length} projects · confidential — management`, M, 75)
    const rows: Row[] = []
    for (const g of groups) {
      const gu = pct(g.spent, g.budget)
      const gd = g.projects.reduce((s, p) => s + (projDelta(p.name) ?? 0), 0)
      rows.push({ type: 'grp', cols: [{ t: `${g.name} · ${g.projects.length}` }, money(g.budget), money(g.approved, C.appr), money(g.spent, toneColor(gu)), money(g.budget - g.spent, g.budget - g.spent < 0 ? C.over : undefined), { t: gu != null ? `${gu}%` : '—', color: toneColor(gu) }, delta.hasBaseline ? deltaCell(gd) : { t: '—', color: C.faint }] })
      for (const p of g.projects) {
        const u = pct(p.spent, p.budget)
        rows.push({ type: 'proj', cols: [{ t: `${p.name}${p.status === 'closed' ? ' · closed' : ''}` }, money(p.budget, undefined, perSft(p.budget, p.area)), money(p.approved, C.appr, perSft(p.approved, p.area)), money(p.spent, toneColor(u), perSft(p.spent, p.area)), money(p.budget - p.spent, p.budget - p.spent < 0 ? C.over : undefined, perSft(p.budget - p.spent, p.area)), { t: u != null ? `${u}%` : '—', color: toneColor(u) }, deltaCell(projDelta(p.name))] })
      }
    }
    rows.push({ type: 'total', cols: [{ t: 'TOTAL' }, money(t.budget), money(t.approved, C.appr), money(t.spent), money(t.budget - t.spent, t.budget - t.spent < 0 ? C.over : undefined), { t: `${usedPct}%` }, delta.hasBaseline ? deltaCell(delta.overall.paid) : { t: '—', color: C.faint }] })
    const y = renderRows(doc, rows, ['Project', ...HEAD_MONEY], 88, M)
    doc.setFontSize(8); doc.setTextColor(...C.mut)
    doc.text(`Δ Paid = change vs the previous upload${prevSnapshotWeek ? ` (${asOf(prevSnapshotWeek)})` : ''}. Each project follows on its own page.`, M, y + 18)
  }

  // One page per project
  for (const { p, group } of projects) {
    page()
    doc.setFontSize(8.5); doc.setTextColor(...C.mut); doc.text(group, M, 36)
    doc.setFontSize(16); doc.setTextColor(...C.ink); doc.text(p.name, M, 55)
    let nx = M + doc.getTextWidth(p.name) + 12
    // status pill
    const pillBg = p.status === 'open' ? C.openBg : C.closedBg
    const pillInk = p.status === 'open' ? C.openInk : C.closedInk
    doc.setFontSize(8); const pw = doc.getTextWidth(p.status) + 12
    doc.setFillColor(...pillBg); doc.roundedRect(nx, 45, pw, 13, 6, 6, 'F')
    doc.setTextColor(...pillInk); doc.text(p.status, nx + 6, 54); nx += pw + 8
    if (p.area) { doc.setTextColor(...C.mut); doc.text(`· ${p.area.toLocaleString('en-IN')} sft`, nx, 54) }

    // KPI boxes
    const bal = p.budget - p.spent; const u = pct(p.spent, p.budget) ?? 0
    const bx = [
      { l: 'BUDGET', n: fmtINR(p.budget), c: undefined as RGB | undefined, d: perSft(p.budget, p.area) },
      { l: 'WO/PO APPROVED', n: fmtINR(p.approved), c: C.appr, d: perSft(p.approved, p.area) },
      { l: `PAID · ${u}%`, n: fmtINR(p.spent), c: C.ok, d: perSft(p.spent, p.area) },
      { l: bal < 0 ? 'OVER BUDGET' : 'BALANCE', n: fmtINR(Math.abs(bal)), c: bal < 0 ? C.over : undefined, d: perSft(Math.abs(bal), p.area) },
    ]
    const by = 66, bh = 42, gap = 8, bwid = (W - M * 2 - gap * 3) / 4
    bx.forEach((k, i) => {
      const x = M + i * (bwid + gap)
      doc.setDrawColor(...C.line); doc.setLineWidth(0.6); doc.setFillColor(255, 255, 255)
      doc.roundedRect(x, by, bwid, bh, 6, 6, 'S')
      doc.setFontSize(6.5); doc.setTextColor(...C.faint); doc.text(k.l, x + 7, by + 12)
      doc.setFontSize(11.5); doc.setTextColor(...(k.c ?? C.ink)); doc.text(k.n, x + 7, by + 27)
      if (k.d) { doc.setFontSize(6.8); doc.setTextColor(...C.mut); doc.text(k.d, x + 7, by + 37) }
    })

    const cats = [...p.categories].sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
    const startY = by + bh + 12
    if (cats.length === 0) {
      doc.setFontSize(9); doc.setTextColor(...C.faint); doc.text('No budget lines for this project.', M, startY + 6)
    } else {
      const rows: Row[] = []
      for (const c of cats) {
        const cu = pct(c.spent, c.budget)
        rows.push({ type: 'cat', cols: [{ t: `${c.code ? c.code + '  ' : ''}${c.label}` }, money(c.budget, undefined, perSft(c.budget, p.area)), money(c.approved, C.appr, perSft(c.approved, p.area)), money(c.spent, toneColor(cu), perSft(c.spent, p.area)), money(c.budget - c.spent, c.budget - c.spent < 0 ? C.over : undefined, perSft(c.budget - c.spent, p.area)), { t: cu != null ? `${cu}%` : '—', color: toneColor(cu) }, deltaCell(catDelta(p.name, c))] })
        if (isSub) for (const sc of c.subcats.filter(x => x.budget !== 0 || x.spent !== 0 || x.approved !== 0)) {
          const su = pct(sc.spent, sc.budget)
          rows.push({ type: 'sub', cols: [{ t: `${sc.code ? sc.code + '  ' : ''}${sc.label}` }, money(sc.budget, undefined, perSft(sc.budget, p.area)), money(sc.approved, C.appr, perSft(sc.approved, p.area)), money(sc.spent, toneColor(su), perSft(sc.spent, p.area)), money(sc.budget - sc.spent, sc.budget - sc.spent < 0 ? C.over : undefined, perSft(sc.budget - sc.spent, p.area)), { t: su != null ? `${su}%` : '—', color: toneColor(su) }, deltaCell(subDelta(p.name, c, sc))] })
        }
      }
      rows.push({ type: 'total', cols: [{ t: `TOTAL · ${p.name}` }, money(p.budget), money(p.approved, C.appr), money(p.spent), money(bal, bal < 0 ? C.over : undefined), { t: `${u}%` }, deltaCell(projDelta(p.name))] })
      const fy = renderRows(doc, rows, [isSub ? 'Category / work-item' : 'Category', ...HEAD_MONEY], startY, M)
      footer(doc, M, fy + 20, `Balance = Budget − Paid · Δ Paid vs previous upload${prevSnapshotWeek ? ` (${asOf(prevSnapshotWeek)})` : ''}`)
    }
  }

  return doc.output('arraybuffer') as unknown as Uint8Array
}
