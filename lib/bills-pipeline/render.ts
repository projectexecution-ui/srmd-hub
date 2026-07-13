import { Resvg } from '@resvg/resvg-js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CardData } from './transform'
import { BP_CONFIG } from './config'

// ─── Colour palette ───────────────────────────────────────────────────────────
const C = {
  NAVY:  '#1b2a4a',
  INK:   '#243b53',
  MUT:   '#627d98',
  RED:   '#c0392b',
  AMBER: '#c77700',
  GREEN: '#2e9e5b',
  BLUE:  '#3d7dd8',
  GOLD:  '#f2c14e',
  WHITE: '#ffffff',
  BG:    '#f0f4f8',
  CARD:  '#ffffff',
}

const FONT_FAMILY = 'Noto Sans'
// Bundled font — see next.config.ts outputFileTracingIncludes so it ships in
// the serverless bundle. resvg cannot render ANY text without a real font.
const FONT_PATH = join(process.cwd(), 'lib', 'bills-pipeline', 'fonts', 'NotoSans.ttf')

// ─── Money helpers ────────────────────────────────────────────────────────────

function inr(n: number): string {
  if (!n) return '0'
  const s   = Math.round(n).toString()
  const neg = s.startsWith('-')
  const abs = neg ? s.slice(1) : s
  if (abs.length <= 3) return (neg ? '-' : '') + abs
  const last3  = abs.slice(-3)
  const rest   = abs.slice(0, -3)
  const groups = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return (neg ? '-' : '') + groups + ',' + last3
}

function compact(n: number): string {
  if (n >= 1_00_00_000) return (n / 1_00_00_000).toFixed(1).replace(/\.0$/, '') + ' Cr'
  if (n >= 1_00_000)    return (n / 1_00_000).toFixed(1).replace(/\.0$/, '')    + ' L'
  return inr(n)
}

// ─── SVG primitives ───────────────────────────────────────────────────────────

function rect(x: number, y: number, w: number, h: number, fill: string, rx = 0): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${rx}"/>`
}

function text(
  x: number, y: number, content: string,
  opts: { fill?: string; size?: number; weight?: number; anchor?: string } = {},
): string {
  const { fill = C.INK, size = 28, weight = 400, anchor = 'start' } = opts
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${FONT_FAMILY}">${esc(content)}</text>`
}

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── buildSvg ─────────────────────────────────────────────────────────────────

export function buildSvg(data: CardData): string {
  const W   = BP_CONFIG.CARD_WIDTH
  const S   = BP_CONFIG.SECTION
  const PAD = 40

  const stageRows = Math.max(data.perStage.length, 1)
  const barsH     = S.BARS_HEADER + stageRows * S.BARS_ROW + S.BARS_PAD
  const pushRows  = Math.max(data.pushList.length, 1)
  const totalH =
    S.TITLE + S.ACTION_BAND + S.KPI_TILES + barsH +
    S.PUSH_HEADER + pushRows * S.PUSH_ROW + S.FOOTER

  const parts: string[] = []
  let y = 0

  parts.push(rect(0, 0, W, totalH, C.BG))

  // ── TITLE ──────────────────────────────────────────────────────────────
  parts.push(rect(0, y, W, S.TITLE, C.NAVY))
  parts.push(text(PAD, y + 62, 'SRA BILLS PIPELINE', { fill: C.WHITE, size: 44, weight: 700 }))
  parts.push(text(PAD, y + 102, 'Weekly Command Card', { fill: C.GOLD, size: 28 }))
  parts.push(text(W - PAD, y + 62, `Week of ${data.weekOf}`, { fill: '#b0bec5', size: 22, anchor: 'end' }))
  const gen = new Date(data.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  parts.push(text(W - PAD, y + 100, `Generated ${gen}`, { fill: '#78909c', size: 18, anchor: 'end' }))
  y += S.TITLE

  // ── ACTION BAND ──────────────────────────────────────────────────────────
  const alert = data.stalledCount > 0 || data.noWOcount > 0
  parts.push(rect(0, y, W, S.ACTION_BAND, alert ? C.RED : C.GREEN))
  const msg = alert
    ? `${data.stalledCount} stalled (idle > ${BP_CONFIG.STALL_DAYS}d)   -   ${data.noWOcount} without WO`
    : 'All internal bills active - no stalls this week'
  parts.push(text(W / 2, y + 50, msg, { fill: C.WHITE, size: 30, weight: 700, anchor: 'middle' }))
  y += S.ACTION_BAND

  // ── KPI TILES ────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total Active', value: String(data.totalBills),    color: C.BLUE },
    { label: 'In Our Court', value: String(data.internalCount), color: C.AMBER },
    { label: 'At Accounts',  value: String(data.trustCount),    color: C.GREEN },
    { label: 'No WO',        value: String(data.noWOcount),     color: data.noWOcount > 0 ? C.RED : C.MUT },
  ]
  const tileW = (W - PAD * 2 - 12 * 3) / 4
  kpis.forEach((kpi, i) => {
    const tx = PAD + i * (tileW + 12)
    const ty = y + 12
    parts.push(rect(tx, ty, tileW, S.KPI_TILES - 24, C.CARD, 12))
    parts.push(rect(tx, ty, 6, S.KPI_TILES - 24, kpi.color, 3))
    parts.push(text(tx + 24, ty + 52, kpi.value, { fill: kpi.color, size: 38, weight: 700 }))
    parts.push(text(tx + 24, ty + 82, kpi.label, { fill: C.MUT, size: 20 }))
  })
  y += S.KPI_TILES

  // ── BAR CHART ────────────────────────────────────────────────────────────
  const barsH2 = S.BARS_HEADER + stageRows * S.BARS_ROW + S.BARS_PAD
  parts.push(rect(PAD, y + 8, W - PAD * 2, barsH2 - 16, C.CARD, 12))
  parts.push(text(PAD + 16, y + 40, 'In Our Court - by stage', { fill: C.INK, size: 22, weight: 700 }))

  if (data.perStage.length === 0) {
    parts.push(text(PAD + 16, y + 80, 'Nothing internal right now - all bills are at Accounts or paid.', { fill: C.MUT, size: 18 }))
  } else {
    const maxCount = Math.max(...data.perStage.map(s => s.count), 1)
    const stageX   = PAD + 16
    const barStart = stageX + 250
    const barMaxW  = W - PAD * 2 - 16 - 250 - 180
    const barH     = 24

    data.perStage.forEach((s, i) => {
      const by   = y + S.BARS_HEADER + i * S.BARS_ROW
      const barW = Math.round((s.count / maxCount) * barMaxW)
      const barColor = s.maxAge >= BP_CONFIG.PUSH_MIN_AGE_DAYS ? C.AMBER : C.BLUE
      const label = s.stage.replace('Under: ', '')
      parts.push(text(stageX, by + 18, label.length > 24 ? label.slice(0, 23) + '…' : label, { fill: C.INK, size: 18 }))
      parts.push(rect(barStart, by, barMaxW, barH, '#e8edf2', 4))
      if (barW > 0) parts.push(rect(barStart, by, barW, barH, barColor, 4))
      parts.push(text(barStart + barMaxW + 10, by + 18, `${s.count}  -  ${compact(s.total)}`, { fill: C.MUT, size: 16 }))
    })
  }
  y += barsH2

  // ── PUSH LIST HEADER ─────────────────────────────────────────────────────
  parts.push(rect(0, y, W, S.PUSH_HEADER, C.INK))
  parts.push(text(PAD, y + 27, `Push List - oldest bills in our court (>=${BP_CONFIG.PUSH_MIN_AGE_DAYS}d, >=${compact(BP_CONFIG.PUSH_MIN_CLAIMED)})`, { fill: C.WHITE, size: 20, weight: 700 }))
  y += S.PUSH_HEADER

  // ── PUSH LIST ROWS ────────────────────────────────────────────────────────
  if (data.pushList.length === 0) {
    parts.push(rect(0, y, W, S.PUSH_ROW, '#f7fafc'))
    parts.push(text(W / 2, y + 26, 'No bills qualify for the push list this week', { fill: C.MUT, size: 20, anchor: 'middle' }))
    y += S.PUSH_ROW
  } else {
    data.pushList.forEach((item, i) => {
      parts.push(rect(0, y, W, S.PUSH_ROW, i % 2 === 0 ? C.CARD : '#f7fafc'))
      parts.push(text(PAD, y + 27, `${i + 1}.`, { fill: C.MUT, size: 16 }))
      const code = data.projectMap[item.projectId] ?? item.project
      parts.push(rect(PAD + 24, y + 9, 46, 22, C.BLUE, 4))
      parts.push(text(PAD + 24 + 23, y + 25, code, { fill: C.WHITE, size: 13, weight: 700, anchor: 'middle' }))
      const nameStr   = item.name.length > 38 ? item.name.slice(0, 37) + '…' : item.name
      const vendorStr = item.vendor ? ` - ${item.vendor}` : ''
      parts.push(text(PAD + 80, y + 26, `${nameStr}${vendorStr}`, { fill: C.INK, size: 17 }))
      const meta = `${compact(item.claimed)}  -  ${item.ageDays}d`
      parts.push(text(W - PAD, y + 26, meta, { fill: C.MUT, size: 16, anchor: 'end' }))
      y += S.PUSH_ROW
    })
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  parts.push(rect(0, y, W, S.FOOTER, C.NAVY))
  parts.push(text(W / 2, y + 38, 'SRMD Construction Technology Hub', { fill: '#90a4ae', size: 20, anchor: 'middle' }))
  parts.push(text(W / 2, y + 66, `Source: Zoho Projects (${Object.keys(BP_CONFIG.PROJECTS).join(', ')})   -   All amounts in ₹`, { fill: '#607d8b', size: 16, anchor: 'middle' }))
  y += S.FOOTER

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">${parts.join('')}</svg>`
}

// ─── svgToPng ─────────────────────────────────────────────────────────────────

export async function svgToPng(svg: string): Promise<Buffer> {
  const hasFont = existsSync(FONT_PATH)
  const resvg = new Resvg(svg, {
    font: {
      // Bundled font guarantees text renders on Vercel (no system fonts there).
      loadSystemFonts: !hasFont,
      fontFiles:       hasFont ? [FONT_PATH] : [],
      defaultFontFamily: FONT_FAMILY,
    },
    fitTo: { mode: 'width', value: BP_CONFIG.CARD_WIDTH },
  })
  return Buffer.from(resvg.render().asPng())
}

export async function renderCard(data: CardData): Promise<Buffer> {
  return svgToPng(buildSvg(data))
}
