import { Resvg } from '@resvg/resvg-js'
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
  BORD:  '#d9e2ec',
}

// ─── Money helpers ────────────────────────────────────────────────────────────

function inr(n: number): string {
  // Indian grouping: last 3 digits, then groups of 2
  if (n === 0) return '0'
  const s   = Math.round(n).toString()
  const neg = s.startsWith('-')
  const abs = neg ? s.slice(1) : s
  if (abs.length <= 3) return (neg ? '-' : '') + abs
  const last3 = abs.slice(-3)
  const rest  = abs.slice(0, -3)
  const groups = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return (neg ? '-' : '') + groups + ',' + last3
}

function compact(n: number): string {
  if (n >= 1_00_00_000) return (n / 1_00_00_000).toFixed(1).replace(/\.0$/, '') + ' Cr'
  if (n >= 1_00_000)    return (n / 1_00_000).toFixed(1).replace(/\.0$/, '')    + ' L'
  return '₹' + inr(n)
}

// ─── SVG primitives ───────────────────────────────────────────────────────────

function rect(x: number, y: number, w: number, h: number, fill: string, rx = 0): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" rx="${rx}"/>`
}

function text(
  x: number, y: number, content: string,
  opts: { fill?: string; size?: number; weight?: string; anchor?: string } = {},
): string {
  const { fill = C.INK, size = 28, weight = 'normal', anchor = 'start' } = opts
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="Arial,sans-serif">${esc(content)}</text>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ─── buildSvg ─────────────────────────────────────────────────────────────────

export function buildSvg(data: CardData): string {
  const W  = BP_CONFIG.CARD_WIDTH
  const S  = BP_CONFIG.SECTION
  const PAD = 40

  const rows = Math.max(data.pushList.length, 1)
  const totalH =
    S.TITLE + S.ACTION_BAND + S.KPI_TILES + S.BARS +
    S.PUSH_HEADER + rows * S.PUSH_ROW + S.FOOTER

  const parts: string[] = []
  let y = 0

  // ── Background ──────────────────────────────────────────────────────────
  parts.push(rect(0, 0, W, totalH, C.BG))

  // ── TITLE SECTION ────────────────────────────────────────────────────────
  parts.push(rect(0, y, W, S.TITLE, C.NAVY))
  parts.push(text(PAD, y + 60, 'SRA BILLS PIPELINE', { fill: C.WHITE, size: 44, weight: 'bold' }))
  parts.push(text(PAD, y + 100, 'Weekly Command Card', { fill: C.GOLD, size: 28 }))
  const weekLabel = `Week of ${data.weekOf}`
  parts.push(text(W - PAD, y + 70, weekLabel, { fill: '#b0bec5', size: 22, anchor: 'end' }))
  const genLabel = `Generated: ${new Date(data.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}`
  parts.push(text(W - PAD, y + 100, genLabel, { fill: '#78909c', size: 18, anchor: 'end' }))
  y += S.TITLE

  // ── ACTION BAND ──────────────────────────────────────────────────────────
  // Stalled warning or "all clear"
  const actionBg = data.stalledCount > 0 ? C.RED : C.GREEN
  parts.push(rect(0, y, W, S.ACTION_BAND, actionBg))
  if (data.stalledCount > 0) {
    const msg = `⚠  ${data.stalledCount} bill${data.stalledCount > 1 ? 's' : ''} stalled (idle > ${BP_CONFIG.STALL_DAYS}d)   •   ${data.noWOcount} without WO`
    parts.push(text(W / 2, y + 50, msg, { fill: C.WHITE, size: 30, weight: 'bold', anchor: 'middle' }))
  } else {
    parts.push(text(W / 2, y + 50, '✓  All internal bills active — no stalls this week', { fill: C.WHITE, size: 28, weight: 'bold', anchor: 'middle' }))
  }
  y += S.ACTION_BAND

  // ── KPI TILES ────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total Active',  value: String(data.totalBills),    color: C.BLUE },
    { label: 'In Our Court',  value: String(data.internalCount), color: C.AMBER },
    { label: 'At Accounts',   value: String(data.trustCount),    color: C.GREEN },
    { label: 'No WO',         value: String(data.noWOcount),     color: data.noWOcount > 0 ? C.RED : C.MUT },
  ]
  const tileW = (W - PAD * 2 - 12 * 3) / 4
  kpis.forEach((kpi, i) => {
    const tx = PAD + i * (tileW + 12)
    const ty = y + 12
    parts.push(rect(tx, ty, tileW, S.KPI_TILES - 24, C.CARD, 12))
    // Left accent bar
    parts.push(rect(tx, ty, 6, S.KPI_TILES - 24, kpi.color, 12))
    parts.push(text(tx + 24, ty + 50, kpi.value, { fill: kpi.color, size: 38, weight: 'bold' }))
    parts.push(text(tx + 24, ty + 80, kpi.label, { fill: C.MUT, size: 20 }))
  })
  y += S.KPI_TILES

  // ── BAR CHART (per internal stage) ───────────────────────────────────────
  parts.push(rect(PAD, y + 8, W - PAD * 2, S.BARS - 16, C.CARD, 12))
  parts.push(text(PAD + 16, y + 40, 'Internal Pipeline by Stage', { fill: C.INK, size: 22, weight: 'bold' }))

  const maxCount   = Math.max(...data.perStage.map(s => s.count), 1)
  const barAreaW   = W - PAD * 2 - 32
  const barH       = 26
  const barSpacing = 38
  const stageX     = PAD + 16
  const barStart   = stageX + 260
  const barMaxW    = barAreaW - 260 - 60

  data.perStage.forEach((s, i) => {
    const by   = y + 56 + i * barSpacing
    const barW = Math.round((s.count / maxCount) * barMaxW)
    const barColor = s.maxAge >= BP_CONFIG.PUSH_MIN_AGE_DAYS ? C.AMBER : C.BLUE

    // Stage label
    const shortStage = s.stage.replace('Under: ', '')
    parts.push(text(stageX, by + 19, shortStage, { fill: C.INK, size: 19 }))
    // Bar
    if (barW > 0) parts.push(rect(barStart, by, barW, barH, barColor, 4))
    // Background track
    parts.push(rect(barStart, by, barMaxW, barH, '#e8edf2', 4))
    if (barW > 0) parts.push(rect(barStart, by, barW, barH, barColor, 4))
    // Count label
    parts.push(text(barStart + barMaxW + 8, by + 19, `${s.count} / ₹${compact(s.total)}`, { fill: C.MUT, size: 17 }))
  })
  y += S.BARS

  // ── PUSH LIST HEADER ─────────────────────────────────────────────────────
  parts.push(rect(0, y, W, S.PUSH_HEADER, C.INK))
  parts.push(text(PAD, y + 27, `Push List — top ${BP_CONFIG.PUSH_LIST_MAX} aged bills (≥${BP_CONFIG.PUSH_MIN_AGE_DAYS}d, ≥₹${compact(BP_CONFIG.PUSH_MIN_CLAIMED)})`, { fill: C.WHITE, size: 20, weight: 'bold' }))
  y += S.PUSH_HEADER

  // ── PUSH LIST ROWS ────────────────────────────────────────────────────────
  if (data.pushList.length === 0) {
    parts.push(rect(0, y, W, S.PUSH_ROW, '#f7fafc'))
    parts.push(text(W / 2, y + 25, 'No bills qualify for the push list this week', { fill: C.MUT, size: 20, anchor: 'middle' }))
    y += S.PUSH_ROW
  } else {
    data.pushList.forEach((item, i) => {
      const rowBg = i % 2 === 0 ? C.CARD : '#f7fafc'
      parts.push(rect(0, y, W, S.PUSH_ROW, rowBg))
      // Row index
      parts.push(text(PAD, y + 27, `${i + 1}.`, { fill: C.MUT, size: 16 }))
      // Project badge
      const code = data.projectMap[item.projectId] ?? item.project
      parts.push(rect(PAD + 24, y + 8, 44, 22, C.BLUE, 4))
      parts.push(text(PAD + 24 + 22, y + 23, code, { fill: C.WHITE, size: 13, weight: 'bold', anchor: 'middle' }))
      // Bill name / vendor
      const nameStr = item.name.length > 40 ? item.name.slice(0, 38) + '…' : item.name
      const vendorStr = item.vendor ? ` — ${item.vendor}` : ''
      parts.push(text(PAD + 76, y + 22, `${nameStr}${vendorStr}`, { fill: C.INK, size: 17 }))
      // Claimed + age + reason
      const meta = `₹${compact(item.claimed)}  ·  ${item.ageDays}d  ·  ${item.reason}`
      parts.push(text(W - PAD, y + 22, meta, { fill: C.MUT, size: 15, anchor: 'end' }))
      y += S.PUSH_ROW
    })
  }

  // ── FOOTER ────────────────────────────────────────────────────────────────
  parts.push(rect(0, y, W, S.FOOTER, C.NAVY))
  parts.push(text(W / 2, y + 38, 'SRMD Construction Technology Hub', { fill: '#90a4ae', size: 20, anchor: 'middle' }))
  parts.push(text(W / 2, y + 66, `Data source: Zoho Projects (${Object.keys(BP_CONFIG.PROJECTS).join(', ')})  •  Stall threshold: ${BP_CONFIG.STALL_DAYS} days`, { fill: '#607d8b', size: 16, anchor: 'middle' }))
  y += S.FOOTER

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}">${parts.join('')}</svg>`
}

// ─── svgToPng ─────────────────────────────────────────────────────────────────

export async function svgToPng(svg: string): Promise<Buffer> {
  const resvg   = new Resvg(svg, {
    font: { loadSystemFonts: false },
    fitTo: { mode: 'width', value: BP_CONFIG.CARD_WIDTH },
  })
  const png = resvg.render().asPng()
  return Buffer.from(png)
}

// ─── Convenience ─────────────────────────────────────────────────────────────

export async function renderCard(data: CardData): Promise<Buffer> {
  return svgToPng(buildSvg(data))
}
