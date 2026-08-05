// Per-project "bills with CT" status card (PNG) for the daily digest email.
// One card = one project's bills still in our court, sorted by DAYS pending
// (oldest first) — no amount ranking, per Aksha's spec. Self-contained SVG
// helpers (kept separate from render.ts so the parallel bills-pipeline work
// isn't disturbed); only svgToPng is reused.

import { svgToPng } from './render'

export interface DigestBill {
  prefix: string        // bill no e.g. MB1-T310
  vendor: string
  status: string        // internal stage e.g. "Under: CT Billing"
  delayDays: number     // days pending in our court
  invoiceNo?: string | null
}

const W = 1000
const PAD = 40
const HEAD_H = 132
const COL_H = 44         // column-header strip
const ROW_H = 46
const FOOT_H = 64
const MAX_ROWS = 22

const C = {
  NAVY:  '#16233d',
  INK:   '#1f2d3d',
  MUT:   '#64748b',
  FAINT: '#94a3b8',
  LINE:  '#e6ebf1',
  BG:    '#ffffff',
  PANEL: '#f7f9fc',
  GREEN: '#2e7d54',
  AMBER: '#c19a3e',
  RED:   '#b3261e',
  WHITE: '#ffffff',
}
const FONT = 'Noto Sans'

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
  o: { fill?: string; size?: number; weight?: number; anchor?: string } = {},
): string {
  const { fill = C.INK, size = 20, weight = 400, anchor = 'start' } = o
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${FONT}">${esc(content)}</text>`
}
function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s
}
function daysColor(d: number): string {
  if (d >= 45) return C.RED
  if (d >= 21) return C.AMBER
  return C.GREEN
}

export function buildProjectStuckSvg(
  projectLabel: string,
  bills: DigestBill[],
  asOf: string,
): string {
  const sorted = [...bills].sort((a, b) => b.delayDays - a.delayDays)
  const shown = sorted.slice(0, MAX_ROWS)
  const hidden = sorted.length - shown.length
  const oldest = sorted[0]?.delayDays ?? 0

  const bodyTop = HEAD_H + COL_H
  const H = bodyTop + shown.length * ROW_H + FOOT_H

  // Column x-anchors
  const xBill = PAD
  const xVendor = 250
  const xStage = 600
  const xDays = W - PAD

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  parts.push(rect(0, 0, W, H, C.BG))

  // Header
  parts.push(rect(0, 0, W, HEAD_H, C.NAVY))
  parts.push(text(PAD, 56, clip(projectLabel, 38), { fill: C.WHITE, size: 34, weight: 700 }))
  parts.push(text(PAD, 92, `Bills with CT · ${sorted.length} pending`, { fill: '#c9d4e6', size: 22, weight: 600 }))
  parts.push(text(W - PAD, 56, `Oldest ${oldest}d`, { fill: daysColor(oldest) === C.RED ? '#ff9a90' : '#c9d4e6', size: 26, weight: 700, anchor: 'end' }))
  parts.push(text(W - PAD, 92, `as of ${esc(asOf)}`, { fill: '#8ea0bd', size: 18, anchor: 'end' }))

  // Column header strip
  parts.push(rect(0, HEAD_H, W, COL_H, C.PANEL))
  const colY = HEAD_H + 29
  parts.push(text(xBill, colY, 'BILL', { fill: C.MUT, size: 16, weight: 700 }))
  parts.push(text(xVendor, colY, 'VENDOR', { fill: C.MUT, size: 16, weight: 700 }))
  parts.push(text(xStage, colY, 'STAGE', { fill: C.MUT, size: 16, weight: 700 }))
  parts.push(text(xDays, colY, 'DAYS', { fill: C.MUT, size: 16, weight: 700, anchor: 'end' }))
  parts.push(line(0, HEAD_H + COL_H, W, HEAD_H + COL_H, C.LINE, 1))

  // Rows
  shown.forEach((b, i) => {
    const y = bodyTop + i * ROW_H
    if (i % 2 === 1) parts.push(rect(0, y, W, ROW_H, '#fbfcfe'))
    const ty = y + 30
    parts.push(text(xBill, ty, clip(b.prefix || '—', 16), { fill: C.INK, size: 20, weight: 600 }))
    parts.push(text(xVendor, ty, clip(b.vendor || '—', 26), { fill: C.INK, size: 20 }))
    parts.push(text(xStage, ty, clip(b.status || '—', 22), { fill: C.MUT, size: 18 }))
    parts.push(text(xDays, ty, `${b.delayDays}d`, { fill: daysColor(b.delayDays), size: 21, weight: 700, anchor: 'end' }))
    parts.push(line(0, y + ROW_H, W, y + ROW_H, C.LINE, 1))
  })

  // Footer
  const fy = bodyTop + shown.length * ROW_H
  parts.push(rect(0, fy, W, FOOT_H, C.PANEL))
  const footLeft = hidden > 0 ? `+ ${hidden} more bill${hidden === 1 ? '' : 's'} not shown` : `${sorted.length} bill${sorted.length === 1 ? '' : 's'} to follow up`
  parts.push(text(PAD, fy + 40, footLeft, { fill: C.MUT, size: 18, weight: 600 }))
  parts.push(text(W - PAD, fy + 40, 'CT HUB · Bills Pipeline', { fill: C.FAINT, size: 16, anchor: 'end' }))

  parts.push('</svg>')
  return parts.join('')
}

export async function renderProjectStuckCard(
  projectLabel: string,
  bills: DigestBill[],
  asOf: string,
): Promise<Buffer> {
  return svgToPng(buildProjectStuckSvg(projectLabel, bills, asOf))
}
