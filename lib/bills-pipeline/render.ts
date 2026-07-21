import { Resvg } from '@resvg/resvg-js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CardData } from './transform'
import { BP_CONFIG } from './config'

// ─── Professional palette (restrained: navy + one gold accent, colour only
//     where it carries meaning — risk red, healthy green) ─────────────────────
const C = {
  NAVY:  '#16233d',
  NAVY2: '#22344f',
  INK:   '#1f2d3d',
  MUT:   '#64748b',
  FAINT: '#94a3b8',
  LINE:  '#e6ebf1',
  BG:    '#ffffff',
  PANEL: '#f7f9fc',
  GOLD:  '#c19a3e',
  BLUE:  '#2f6fb0',
  GREEN: '#2e7d54',
  AMBER: '#c98a1a',
  ORANGE:'#cf7434',
  RED:   '#bf3b30',
  WHITE: '#ffffff',
}
// Sequential blue ramp for the project stacked bar (largest = darkest)
const PROJ_RAMP = ['#1f4e79', '#2f6fb0', '#4a90c2', '#7fb0d4', '#b9d3e6', '#d4e3f0', '#8a6d3b']

const FONT_FAMILY = 'Noto Sans'
const FONT_PATH = join(process.cwd(), 'lib', 'bills-pipeline', 'fonts', 'NotoSans.ttf')

const W   = BP_CONFIG.CARD_WIDTH   // 1080
const PAD = 48

// ─── Money ────────────────────────────────────────────────────────────────────
function inr(n: number): string {
  const v = Math.round(n)
  if (!v) return '0'
  const s = Math.abs(v).toString()
  const neg = v < 0 ? '-' : ''
  if (s.length <= 3) return neg + s
  return neg + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3)
}
/** Compact Indian notation: ₹2.40 Cr / ₹90.5 L / ₹78,900 */
function rupees(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_00_00_000) return '₹' + (n / 1_00_00_000).toFixed(2) + ' Cr'
  if (a >= 1_00_000)    return '₹' + (n / 1_00_000).toFixed(1).replace(/\.0$/, '') + ' L'
  return '₹' + inr(n)
}

// ─── SVG primitives ─────────────────────────────────────────────────────────
function rect(x: number, y: number, w: number, h: number, fill: string, rx = 0): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${rx}"/>`
}
function line(x1: number, y1: number, x2: number, y2: number, stroke: string, sw = 1): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"/>`
}
function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
function fmtDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso)
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })
}

// A small week-over-week delta chip: arrow + compact ₹, coloured by whether the
// movement is good or bad for that metric.
function deltaText(delta: number | null, dir: 'lowerBetter' | 'higherBetter' | 'neutral'): { s: string; fill: string } | null {
  if (delta == null) return null
  if (delta === 0) return { s: '— no change', fill: C.FAINT }
  const up = delta > 0
  const good = dir === 'neutral' ? null : (dir === 'lowerBetter' ? !up : up)
  const fill = good == null ? C.MUT : good ? C.GREEN : C.RED
  // Noto Sans (base) has no ▲/▼ glyphs — use +/- which always render.
  return { s: `${up ? '+' : '-'}${rupees(Math.abs(delta))} wk`, fill }
}

// ─── buildSvg ─────────────────────────────────────────────────────────────────
export function buildSvg(d: CardData): string {
  const P: string[] = []
  let y = 0

  // Layout constants
  const H_HEADER = 138
  const H_EXEC   = 62
  const H_KPI    = 156
  const AGE_HEAD = 58
  const AGE_ROW  = 46
  const H_AGE    = AGE_HEAD + d.ageBuckets.length * AGE_ROW + 6
  const H_PROJ   = 148
  const FUP_TITLE = 56
  const FUP_HEAD  = 40
  const FUP_ROW   = 46
  const fupRows   = Math.max(d.followUps.length, 1)
  const H_FUP     = FUP_TITLE + FUP_HEAD + fupRows * FUP_ROW + 16
  const H_FOOTER  = 96
  const totalH = H_HEADER + H_EXEC + H_KPI + H_AGE + H_PROJ + H_FUP + H_FOOTER

  P.push(rect(0, 0, W, totalH, C.BG))

  // ── HEADER ───────────────────────────────────────────────────────────────
  P.push(rect(0, y, W, H_HEADER, C.NAVY))
  P.push(rect(PAD, y + 40, 5, 58, C.GOLD, 2))
  P.push(text(PAD + 22, y + 66, 'SRA CONTRACTOR BILLS', { fill: C.WHITE, size: 38, weight: 700, spacing: 0.5 }))
  P.push(text(PAD + 22, y + 100, 'Weekly Pipeline Status', { fill: C.GOLD, size: 22, weight: 500 }))
  P.push(text(W - PAD, y + 60, `As on ${fmtDate(d.asOf)}`, { fill: '#c7d2e0', size: 22, weight: 500, anchor: 'end' }))
  P.push(text(W - PAD, y + 92, 'Confidential · for management review', { fill: C.FAINT, size: 16, anchor: 'end' }))
  y += H_HEADER

  // ── EXECUTIVE SUMMARY BAND ──────────────────────────────────────────────────
  P.push(rect(0, y, W, H_EXEC, C.PANEL))
  P.push(line(0, y + H_EXEC, W, y + H_EXEC, C.LINE, 1))
  const oldest = d.followUps[0]?.ageDays ?? 0
  const sentence = d.ctCount === 0
    ? 'No bills pending with CT — all clear with Trust Accounts or paid.'
    : `${rupees(d.ctValue)} pending with CT (${d.ctCount} bills) · ${rupees(d.stalledValue)} stalled · oldest ${oldest}d`
  P.push(text(PAD, y + 38, sentence, { fill: C.INK, size: 19, weight: 500 }))
  const clearedTxt = d.clearedValue > 0 || d.clearedCount > 0
    ? `${rupees(d.clearedValue)} cleared this week · ${d.clearedCount} ${d.clearedCount === 1 ? 'bill' : 'bills'}`
    : 'No bills cleared in last 7 days'
  P.push(text(W - PAD, y + 38, clearedTxt, { fill: d.clearedCount > 0 ? C.GREEN : C.FAINT, size: 18, weight: 600, anchor: 'end' }))
  y += H_EXEC

  // ── KPI TILES (with week-over-week deltas) ──────────────────────────────────
  const tiles: Array<{ label: string; value: string; sub: string; accent: string; delta: number | null; dir: 'lowerBetter' | 'higherBetter' | 'neutral' }> = [
    { label: 'PIPELINE VALUE', value: rupees(d.totalValue),   sub: `${d.totalCount} live bills`, accent: C.NAVY2, delta: d.deltas.totalValue,   dir: 'neutral' },
    { label: 'PENDING WITH CT', value: rupees(d.ctValue),     sub: `${d.ctCount} bills`,         accent: C.AMBER, delta: d.deltas.ctValue,      dir: 'lowerBetter' },
    { label: 'WITH TRUST A/C',  value: rupees(d.trustValue),  sub: `${d.trustCount} bills`,      accent: C.GREEN, delta: d.deltas.trustValue,   dir: 'neutral' },
    { label: 'NEEDS ATTENTION', value: rupees(d.stalledValue), sub: `${d.stalledCount} stalled > ${BP_CONFIG.STALL_DAYS}d`, accent: C.RED, delta: d.deltas.stalledValue, dir: 'lowerBetter' },
  ]
  const gap = 16
  const tileW = (W - PAD * 2 - gap * 3) / 4
  const tileH = H_KPI - 32
  tiles.forEach((t, i) => {
    const tx = PAD + i * (tileW + gap)
    const ty = y + 16
    P.push(rect(tx, ty, tileW, tileH, C.PANEL, 10))
    P.push(rect(tx, ty, tileW, 4, t.accent, 2))
    P.push(text(tx + 18, ty + 32, t.label, { fill: C.MUT, size: 14, weight: 600, spacing: 0.8 }))
    P.push(text(tx + 18, ty + 74, t.value, { fill: C.INK, size: 31, weight: 700 }))
    P.push(text(tx + 18, ty + 102, t.sub, { fill: t.accent, size: 15, weight: 600 }))
    const dt = deltaText(t.delta, t.dir)
    if (dt) P.push(text(tx + tileW - 18, ty + 102, dt.s, { fill: dt.fill, size: 14, weight: 600, anchor: 'end' }))
  })
  y += H_KPI

  // ── AGEING (bills pending with CT) ──────────────────────────────────────────
  P.push(text(PAD, y + 34, 'Ageing of bills pending with CT', { fill: C.INK, size: 24, weight: 700 }))
  P.push(text(W - PAD, y + 34, 'by value', { fill: C.FAINT, size: 16, anchor: 'end' }))
  P.push(line(PAD, y + 46, W - PAD, y + 46, C.LINE, 1))

  const ageColors = [C.GREEN, C.AMBER, C.ORANGE, C.RED]
  const maxVal = Math.max(...d.ageBuckets.map(b => b.value), 1)
  const labelW = 150
  const barX   = PAD + labelW
  const barMaxW = W - PAD * 2 - labelW - 250
  const barH   = 22
  d.ageBuckets.forEach((b, i) => {
    const by = y + AGE_HEAD + i * AGE_ROW
    P.push(text(PAD, by + 16, b.label, { fill: C.INK, size: 18, weight: 500 }))
    P.push(rect(barX, by, barMaxW, barH, C.PANEL, 4))
    const w = Math.round((b.value / maxVal) * barMaxW)
    if (w > 0) P.push(rect(barX, by, w, barH, ageColors[i] ?? C.BLUE, 4))
    P.push(text(barX + barMaxW + 16, by + 16, `${rupees(b.value)}  ·  ${b.count} ${b.count === 1 ? 'bill' : 'bills'}`, { fill: C.MUT, size: 16, weight: 500 }))
  })
  y += H_AGE

  // ── PENDING WITH CT — BY PROJECT (stacked bar) ──────────────────────────────
  P.push(text(PAD, y + 34, 'Pending with CT — by project', { fill: C.INK, size: 24, weight: 700 }))
  P.push(text(W - PAD, y + 34, 'share of value', { fill: C.FAINT, size: 16, anchor: 'end' }))
  P.push(line(PAD, y + 46, W - PAD, y + 46, C.LINE, 1))

  const projTotal = d.byProject.reduce((s, p) => s + p.value, 0)
  const sbY = y + 62
  const sbH = 30
  const sbW = W - PAD * 2
  if (projTotal <= 0) {
    P.push(text(PAD, sbY + 40, 'No bills pending with CT.', { fill: C.MUT, size: 18 }))
  } else {
    // stacked bar
    let sx = PAD
    P.push(rect(PAD, sbY, sbW, sbH, C.PANEL, 6))
    d.byProject.forEach((p, i) => {
      const w = Math.max(2, Math.round((p.value / projTotal) * sbW))
      const clampW = Math.min(w, PAD + sbW - sx)
      P.push(rect(sx, sbY, clampW, sbH, PROJ_RAMP[i] ?? C.BLUE, 0))
      sx += clampW
    })
    // rounded mask ends
    P.push(`<rect x="${PAD}" y="${sbY}" width="${sbW}" height="${sbH}" rx="6" fill="none" stroke="${C.BG}" stroke-width="0"/>`)
    // legend
    let lx = PAD
    const ly = sbY + sbH + 30
    d.byProject.forEach((p, i) => {
      P.push(rect(lx, ly - 12, 14, 14, PROJ_RAMP[i] ?? C.BLUE, 3))
      const label = `${p.code}  ${rupees(p.value)} (${p.count})`
      P.push(text(lx + 22, ly, label, { fill: C.INK, size: 16, weight: 500 }))
      lx += 22 + label.length * 9.2 + 26
    })
  }
  y += H_PROJ

  // ── PRIORITY FOLLOW-UPS ──────────────────────────────────────────────────────
  P.push(text(PAD, y + 34, 'Priority follow-ups', { fill: C.INK, size: 24, weight: 700 }))
  P.push(text(PAD, y + 54, 'Oldest bills pending with CT — push these first', { fill: C.MUT, size: 15 }))
  y += FUP_TITLE

  const cProj   = PAD
  const cName   = PAD + 68
  const cStatus = 408
  const cBill   = 600
  const cAmt    = 902
  const cAge    = W - PAD
  P.push(rect(0, y, W, FUP_HEAD, C.PANEL))
  P.push(text(cProj,   y + 26, 'PROJECT', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6 }))
  P.push(text(cName,   y + 26, 'CONTRACTOR', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6 }))
  P.push(text(cStatus, y + 26, 'STATUS', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6 }))
  P.push(text(cBill,   y + 26, 'BILL NO', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6 }))
  P.push(text(cAmt,    y + 26, 'AMOUNT', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6, anchor: 'end' }))
  P.push(text(cAge,    y + 26, 'AGE', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6, anchor: 'end' }))
  y += FUP_HEAD

  if (d.followUps.length === 0) {
    P.push(rect(0, y, W, FUP_ROW, C.BG))
    P.push(text(W / 2, y + 28, 'No bills pending with CT — all bills are with Trust Accounts or paid.', { fill: C.MUT, size: 18, anchor: 'middle' }))
    y += FUP_ROW
  } else {
    d.followUps.forEach((f, i) => {
      const ry = y + i * FUP_ROW
      if (i % 2 === 1) P.push(rect(0, ry, W, FUP_ROW, C.PANEL))
      P.push(line(0, ry + FUP_ROW, W, ry + FUP_ROW, C.LINE, 1))
      const code = d.projectMap[f.projectId] ?? f.project
      P.push(rect(cProj, ry + 11, 52, 24, C.NAVY, 5))
      P.push(text(cProj + 26, ry + 28, code, { fill: C.WHITE, size: 13, weight: 700, anchor: 'middle' }))
      // contractor (+ small No-WO dot flag so the tag doesn't crowd Status)
      P.push(text(cName, ry + 29, clip(f.contractor || '(unnamed)', 20), { fill: C.INK, size: 18, weight: 500 }))
      if (f.noWO) {
        P.push(rect(cStatus - 74, ry + 13, 62, 20, '#fbe6d4', 4))
        P.push(text(cStatus - 74 + 31, ry + 27, 'No WO', { fill: C.ORANGE, size: 12, weight: 700, anchor: 'middle' }))
      }
      // status (short — drop the "Under: " prefix)
      P.push(text(cStatus, ry + 29, clip(f.stage.replace(/^Under:\s*/, ''), 20), { fill: C.INK, size: 16 }))
      P.push(text(cBill, ry + 29, clip(f.billNo || '—', 18), { fill: C.MUT, size: 16 }))
      P.push(text(cAmt, ry + 29, '₹' + inr(f.value), { fill: C.INK, size: 18, weight: 600, anchor: 'end' }))
      P.push(text(cAge, ry + 29, `${f.ageDays}d`, { fill: f.stalled ? C.RED : C.MUT, size: 18, weight: f.stalled ? 700 : 500, anchor: 'end' }))
    })
    y += d.followUps.length * FUP_ROW
  }
  y += 16

  // ── FOOTER ────────────────────────────────────────────────────────────────
  P.push(rect(0, y, W, H_FOOTER, C.NAVY))
  P.push(text(PAD, y + 40, 'SRMD Construction Technology Hub', { fill: '#c7d2e0', size: 18, weight: 600 }))
  P.push(text(PAD, y + 66, `Source: Zoho Projects — ${d.projectScorecard.map(s => s.code).join(', ')} · All amounts in ₹`, { fill: C.FAINT, size: 15 }))
  const gen = new Date(d.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  P.push(text(W - PAD, y + 40, 'Auto-generated weekly', { fill: '#c7d2e0', size: 16, anchor: 'end' }))
  P.push(text(W - PAD, y + 66, gen, { fill: C.FAINT, size: 15, anchor: 'end' }))
  y += H_FOOTER

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">${P.join('')}</svg>`
}

// ─── Project Scorecard report ───────────────────────────────────────────────
export function buildScorecardSvg(d: CardData): string {
  const P: string[] = []
  let y = 0

  const H_HEADER = 138
  const SUB      = 46
  const TH       = 44
  const ROW      = 58
  const rows     = d.projectScorecard.length
  const H_FOOTER = 96
  const totalH   = H_HEADER + SUB + TH + rows * ROW + ROW /*total*/ + H_FOOTER + 24

  P.push(rect(0, 0, W, totalH, C.BG))

  // Header
  P.push(rect(0, y, W, H_HEADER, C.NAVY))
  P.push(rect(PAD, y + 40, 5, 58, C.GOLD, 2))
  P.push(text(PAD + 22, y + 66, 'PROJECT SCORECARD', { fill: C.WHITE, size: 38, weight: 700, spacing: 0.5 }))
  P.push(text(PAD + 22, y + 100, 'SRA Contractor Bills · per-site status', { fill: C.GOLD, size: 22, weight: 500 }))
  P.push(text(W - PAD, y + 60, `As on ${fmtDate(d.asOf)}`, { fill: '#c7d2e0', size: 22, weight: 500, anchor: 'end' }))
  P.push(text(W - PAD, y + 92, 'Confidential · for management review', { fill: C.FAINT, size: 16, anchor: 'end' }))
  y += H_HEADER

  P.push(text(PAD, y + 32, 'Live bill value by site — pipeline, ownership and stalls', { fill: C.MUT, size: 17 }))
  y += SUB

  // Columns (amounts right-anchored)
  const cols = [
    { label: 'PIPELINE',  x: 430,  val: (r: typeof d.projectScorecard[number]) => r.totalValue,   cnt: (r: typeof d.projectScorecard[number]) => r.totalCount,   danger: false },
    { label: 'WITH CT',   x: 640,  val: (r: typeof d.projectScorecard[number]) => r.ctValue,      cnt: (r: typeof d.projectScorecard[number]) => r.ctCount,      danger: false },
    { label: 'AT TRUST',  x: 840,  val: (r: typeof d.projectScorecard[number]) => r.trustValue,   cnt: (r: typeof d.projectScorecard[number]) => r.trustCount,   danger: false },
    { label: 'STALLED',   x: W - PAD, val: (r: typeof d.projectScorecard[number]) => r.stalledValue, cnt: (r: typeof d.projectScorecard[number]) => r.stalledCount, danger: true },
  ]

  // Table header
  P.push(rect(0, y, W, TH, C.PANEL))
  P.push(text(PAD, y + 28, 'PROJECT', { fill: C.MUT, size: 13, weight: 700, spacing: 0.6 }))
  cols.forEach(c => P.push(text(c.x, y + 28, c.label, { fill: C.MUT, size: 13, weight: 700, spacing: 0.6, anchor: 'end' })))
  y += TH

  const drawCell = (x: number, ry: number, value: number, count: number, danger: boolean) => {
    const col = danger && value > 0 ? C.RED : C.INK
    P.push(text(x, ry + 26, rupees(value), { fill: col, size: 19, weight: 600, anchor: 'end' }))
    P.push(text(x, ry + 46, `${count} ${count === 1 ? 'bill' : 'bills'}`, { fill: C.FAINT, size: 14, anchor: 'end' }))
  }

  d.projectScorecard.forEach((r, i) => {
    const ry = y + i * ROW
    if (i % 2 === 1) P.push(rect(0, ry, W, ROW, C.PANEL))
    P.push(line(0, ry + ROW, W, ry + ROW, C.LINE, 1))
    P.push(rect(PAD, ry + 16, 58, 26, C.NAVY, 5))
    P.push(text(PAD + 29, ry + 34, r.code, { fill: C.WHITE, size: 14, weight: 700, anchor: 'middle' }))
    cols.forEach(c => drawCell(c.x, ry, c.val(r), c.cnt(r), c.danger))
  })
  y += rows * ROW

  // Total row
  P.push(rect(0, y, W, ROW, '#eef2f7'))
  P.push(line(0, y, W, y, C.LINE, 1))
  P.push(text(PAD, y + 36, 'TOTAL', { fill: C.INK, size: 17, weight: 700, spacing: 0.5 }))
  const totals = [
    { x: 430,    v: d.totalValue,   c: d.totalCount,   danger: false },
    { x: 640,    v: d.ctValue,      c: d.ctCount,      danger: false },
    { x: 840,    v: d.trustValue,   c: d.trustCount,   danger: false },
    { x: W - PAD, v: d.stalledValue, c: d.stalledCount, danger: true },
  ]
  totals.forEach(t => {
    const col = t.danger && t.v > 0 ? C.RED : C.INK
    P.push(text(t.x, y + 30, rupees(t.v), { fill: col, size: 19, weight: 700, anchor: 'end' }))
    P.push(text(t.x, y + 48, `${t.c} ${t.c === 1 ? 'bill' : 'bills'}`, { fill: C.MUT, size: 14, anchor: 'end' }))
  })
  y += ROW + 24

  // Footer
  P.push(rect(0, y, W, H_FOOTER, C.NAVY))
  P.push(text(PAD, y + 40, 'SRMD Construction Technology Hub', { fill: '#c7d2e0', size: 18, weight: 600 }))
  P.push(text(PAD, y + 66, `Source: Zoho Projects — ${d.projectScorecard.map(s => s.code).join(', ')} · All amounts in ₹`, { fill: C.FAINT, size: 15 }))
  const gen = new Date(d.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  P.push(text(W - PAD, y + 40, 'Auto-generated weekly', { fill: '#c7d2e0', size: 16, anchor: 'end' }))
  P.push(text(W - PAD, y + 66, gen, { fill: C.FAINT, size: 15, anchor: 'end' }))
  y += H_FOOTER

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">${P.join('')}</svg>`
}

export async function renderScorecard(data: CardData): Promise<Buffer> {
  return svgToPng(buildScorecardSvg(data))
}

// ─── svgToPng ─────────────────────────────────────────────────────────────────
export async function svgToPng(svg: string): Promise<Buffer> {
  const hasFont = existsSync(FONT_PATH)
  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: !hasFont,
      fontFiles:       hasFont ? [FONT_PATH] : [],
      defaultFontFamily: FONT_FAMILY,
    },
    fitTo: { mode: 'width', value: W },
  })
  return Buffer.from(resvg.render().asPng())
}

export async function renderCard(data: CardData): Promise<Buffer> {
  return svgToPng(buildSvg(data))
}
