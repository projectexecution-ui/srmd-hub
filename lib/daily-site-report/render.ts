// Daily "material arrived" digest card (PNG). Reuses the bills-pipeline
// resvg pipeline (svgToPng + bundled NotoSans.ttf) so there's no new infra.
// Base Noto Sans lacks ▲▼✓ glyphs — stick to plain text / +/- only.

import { svgToPng } from '@/lib/bills-pipeline/render'

const W = 1080
const PAD = 48

const C = {
  NAVY:  '#16233d',
  INK:   '#1f2d3d',
  MUT:   '#64748b',
  FAINT: '#94a3b8',
  LINE:  '#e6ebf1',
  BG:    '#ffffff',
  PANEL: '#f7f9fc',
  TEAL:  '#0f766e',
  GREEN: '#2e7d54',
  GOLD:  '#c19a3e',
  WHITE: '#ffffff',
}
const FONT_FAMILY = 'Noto Sans'

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function rect(x: number, y: number, w: number, h: number, fill: string, rx = 0): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${rx}"/>`
}
function line(x1: number, y1: number, x2: number, y2: number, stroke: string, sw = 1): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>`
}
function text(
  x: number, y: number, content: string,
  o: { fill?: string; size?: number; weight?: number; anchor?: string; spacing?: number } = {},
): string {
  const { fill = C.INK, size = 20, weight = 400, anchor = 'start', spacing } = o
  const ls = spacing != null ? ` letter-spacing="${spacing}"` : ''
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${FONT_FAMILY}"${ls}>${esc(content)}</text>`
}
function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s
}
function inr(n: number): string {
  const v = Math.round(n)
  if (!v) return '0'
  const s = Math.abs(v).toString()
  const neg = v < 0 ? '-' : ''
  if (s.length <= 3) return neg + s
  return neg + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3)
}
function rupees(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_00_00_000) return '₹' + (n / 1_00_00_000).toFixed(2) + ' Cr'
  if (a >= 1_00_000)    return '₹' + (n / 1_00_000).toFixed(1).replace(/\.0$/, '') + ' L'
  return '₹' + inr(n)
}
function fmtDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso)
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
}

export interface DigestRow {
  site: string
  supplier: string
  material: string
  qty: string
  amount: number | null
  stage: string
}
export interface DigestData {
  date: string
  generatedAt: string
  rows: DigestRow[]
}

export function buildDigestSvg(d: DigestData): string {
  const P: string[] = []
  let y = 0

  const rows = d.rows
  const totalValue = rows.reduce((s, r) => s + (r.amount ?? 0), 0)
  const siteCount = new Set(rows.map(r => r.site)).size

  const H_HEADER = 132
  const H_SUM = 60
  const TH = 42
  const ROW = 46
  const bodyRows = Math.max(rows.length, 1)
  const H_FOOTER = 88
  const totalH = H_HEADER + H_SUM + TH + bodyRows * ROW + H_FOOTER + 20

  P.push(rect(0, 0, W, totalH, C.BG))

  // Header
  P.push(rect(0, y, W, H_HEADER, C.NAVY))
  P.push(rect(PAD, y + 38, 5, 56, C.TEAL, 2))
  P.push(text(PAD + 22, y + 62, 'DAILY SITE REPORT', { fill: C.WHITE, size: 36, weight: 700, spacing: 0.5 }))
  P.push(text(PAD + 22, y + 96, 'Material arrived at site', { fill: '#8fd3cc', size: 21, weight: 500 }))
  P.push(text(W - PAD, y + 58, fmtDate(d.date), { fill: '#c7d2e0', size: 22, weight: 600, anchor: 'end' }))
  P.push(text(W - PAD, y + 90, 'Confidential · for management review', { fill: C.FAINT, size: 15, anchor: 'end' }))
  y += H_HEADER

  // Summary band
  P.push(rect(0, y, W, H_SUM, C.PANEL))
  P.push(line(0, y + H_SUM, W, y + H_SUM, C.LINE, 1))
  const summary = rows.length === 0
    ? 'No material deliveries logged for this day.'
    : `${rows.length} ${rows.length === 1 ? 'delivery' : 'deliveries'} · ${rupees(totalValue)} total · ${siteCount} ${siteCount === 1 ? 'site' : 'sites'}`
  P.push(text(PAD, y + 38, summary, { fill: C.INK, size: 20, weight: 600 }))
  y += H_SUM

  // Table header
  const cSite = PAD
  const cSupplier = PAD + 66
  const cMaterial = 350
  const cQty = 690
  const cAmt = 900
  const cStage = W - PAD
  P.push(rect(0, y, W, TH, C.PANEL))
  P.push(text(cSite, y + 27, 'SITE', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6 }))
  P.push(text(cSupplier, y + 27, 'SUPPLIER', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6 }))
  P.push(text(cMaterial, y + 27, 'MATERIAL', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6 }))
  P.push(text(cQty, y + 27, 'QTY', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6 }))
  P.push(text(cAmt, y + 27, 'AMOUNT', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6, anchor: 'end' }))
  P.push(text(cStage, y + 27, 'STATUS', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6, anchor: 'end' }))
  y += TH

  if (rows.length === 0) {
    P.push(rect(0, y, W, ROW, C.BG))
    P.push(text(W / 2, y + 28, 'Nothing to report for this day.', { fill: C.MUT, size: 18, anchor: 'middle' }))
    y += ROW
  } else {
    rows.forEach((r, i) => {
      const ry = y + i * ROW
      if (i % 2 === 1) P.push(rect(0, ry, W, ROW, C.PANEL))
      P.push(line(0, ry + ROW, W, ry + ROW, C.LINE, 1))
      P.push(rect(cSite, ry + 12, 52, 24, C.NAVY, 5))
      P.push(text(cSite + 26, ry + 29, clip(r.site, 6), { fill: C.WHITE, size: 12, weight: 700, anchor: 'middle' }))
      P.push(text(cSupplier, ry + 30, clip(r.supplier || '—', 22), { fill: C.INK, size: 17, weight: 500 }))
      P.push(text(cMaterial, ry + 30, clip(r.material || '—', 26), { fill: C.INK, size: 17 }))
      P.push(text(cQty, ry + 30, clip(r.qty || '—', 12), { fill: C.MUT, size: 16 }))
      P.push(text(cAmt, ry + 30, r.amount != null ? rupees(r.amount) : '—', { fill: C.INK, size: 17, weight: 600, anchor: 'end' }))
      P.push(text(cStage, ry + 30, clip(r.stage, 18), { fill: C.TEAL, size: 15, weight: 600, anchor: 'end' }))
    })
    y += rows.length * ROW
  }
  y += 20

  // Footer
  P.push(rect(0, y, W, H_FOOTER, C.NAVY))
  P.push(text(PAD, y + 38, 'SRMD Construction Technology Hub', { fill: '#c7d2e0', size: 18, weight: 600 }))
  P.push(text(PAD, y + 62, 'Source: Daily Site Report · All amounts in ₹', { fill: C.FAINT, size: 15 }))
  const gen = new Date(d.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  P.push(text(W - PAD, y + 38, 'Daily material summary', { fill: '#c7d2e0', size: 16, anchor: 'end' }))
  P.push(text(W - PAD, y + 62, gen, { fill: C.FAINT, size: 15, anchor: 'end' }))
  y += H_FOOTER

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">${P.join('')}</svg>`
}

export async function renderDigest(d: DigestData): Promise<Buffer> {
  return svgToPng(buildDigestSvg(d))
}
