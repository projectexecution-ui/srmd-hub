// Render a notification/report into a clean 1080px-wide PNG "report card" —
// the same SVG→PNG pipeline the Bills pipeline uses (@resvg/resvg-js + the
// bundled Noto Sans font). Telegram sends these as photos, which forward
// straight to WhatsApp as a shareable image.

import { Resvg } from '@resvg/resvg-js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const FONT_FAMILY = 'Noto Sans'
// Reuse the font already bundled for the Bills pipeline cards.
const FONT_PATH = join(process.cwd(), 'lib', 'bills-pipeline', 'fonts', 'NotoSans.ttf')

const W = 1080
const PAD = 56

const C = {
  NAVY: '#16233d', GOLD: '#c19a3e', INK: '#1f2d3d', MUT: '#475569',
  FAINT: '#94a3b8', LINE: '#e6ebf1', BG: '#ffffff', PANEL: '#f7f9fc', WHITE: '#ffffff',
}

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function text(
  x: number, y: number, content: string,
  o: { fill?: string; size?: number; weight?: number; anchor?: string; spacing?: number } = {},
): string {
  const { fill = C.INK, size = 30, weight = 400, anchor = 'start', spacing } = o
  const ls = spacing != null ? ` letter-spacing="${spacing}"` : ''
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${FONT_FAMILY}"${ls}>${esc(content)}</text>`
}

// The bundled Noto Sans (base) has no arrow / triangle glyphs — they'd render
// as tofu boxes. Swap the ones our report text actually uses for ASCII.
function sanitize(s: string): string {
  return (s ?? '')
    .replace(/[→⟶⇒]/g, '->')
    .replace(/[←⟵⇐]/g, '<-')
    .replace(/↔/g, '<->')
    .replace(/[▲▴]/g, '^')
    .replace(/[▼▾]/g, 'v')
}

// Word-wrap to ~maxChars per line, honouring any existing newlines (digests
// carry their own line breaks). Very long single words are hard-split.
function wrap(body: string, maxChars: number): string[] {
  const out: string[] = []
  for (const raw of sanitize(body).replace(/\r/g, '').split('\n')) {
    if (raw.trim() === '') { out.push(''); continue }
    let cur = ''
    for (const word of raw.split(/\s+/)) {
      if ((cur ? cur.length + 1 : 0) + word.length > maxChars) {
        if (cur) { out.push(cur); cur = '' }
        if (word.length > maxChars) {
          let w = word
          while (w.length > maxChars) { out.push(w.slice(0, maxChars)); w = w.slice(maxChars) }
          cur = w
        } else cur = word
      } else {
        cur = cur ? `${cur} ${word}` : word
      }
    }
    if (cur) out.push(cur)
  }
  return out
}

export async function renderReportCard(opts: { title: string; body: string; dateLabel?: string }): Promise<Buffer> {
  const P: string[] = []

  const H_HEADER = 150
  const titleLines = wrap(opts.title || 'Report', 40)
  const bodyLines = wrap(opts.body || '', 56)
  const TITLE_LH = 52
  const BODY_LH = 44
  const titleBlock = 60 + titleLines.length * TITLE_LH + 28
  const bodyBlock = Math.max(bodyLines.length, 1) * BODY_LH + 40
  const H_FOOTER = 92
  const totalH = H_HEADER + titleBlock + bodyBlock + H_FOOTER

  P.push(`<rect x="0" y="0" width="${W}" height="${totalH}" fill="${C.BG}"/>`)

  // Header band
  P.push(`<rect x="0" y="0" width="${W}" height="${H_HEADER}" fill="${C.NAVY}"/>`)
  P.push(`<rect x="${PAD}" y="46" width="6" height="60" fill="${C.GOLD}" rx="2"/>`)
  P.push(text(PAD + 26, 82, 'CT HUB', { fill: C.WHITE, size: 40, weight: 700, spacing: 1 }))
  P.push(text(PAD + 26, 118, 'Report', { fill: C.GOLD, size: 24, weight: 500 }))
  if (opts.dateLabel) P.push(text(W - PAD, 100, opts.dateLabel, { fill: '#c7d2e0', size: 24, weight: 500, anchor: 'end' }))

  // Title
  let y = H_HEADER + 62
  for (const tl of titleLines) { P.push(text(PAD, y, tl, { fill: C.INK, size: 40, weight: 700 })); y += TITLE_LH }
  y += 8
  P.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${C.LINE}" stroke-width="2"/>`)
  y += 44

  // Body
  for (const bl of bodyLines) { if (bl) P.push(text(PAD, y, bl, { fill: C.MUT, size: 30, weight: 400 })); y += BODY_LH }

  // Footer
  const fy = totalH - H_FOOTER
  P.push(`<rect x="0" y="${fy}" width="${W}" height="${H_FOOTER}" fill="${C.PANEL}"/>`)
  P.push(`<line x1="0" y1="${fy}" x2="${W}" y2="${fy}" stroke="${C.LINE}" stroke-width="2"/>`)
  P.push(text(PAD, fy + 56, 'CT HUB · Construction Tracking', { fill: C.FAINT, size: 22, weight: 500 }))
  P.push(text(W - PAD, fy + 56, 'Confidential · management', { fill: C.FAINT, size: 20, anchor: 'end' }))

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}">${P.join('')}</svg>`
  const hasFont = existsSync(FONT_PATH)
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: !hasFont, fontFiles: hasFont ? [FONT_PATH] : [], defaultFontFamily: FONT_FAMILY },
    fitTo: { mode: 'width', value: W },
  })
  return Buffer.from(resvg.render().asPng())
}

// Report/digest notification types get the image-card treatment; quick alerts
// (approvals, @mentions) stay as fast tappable text. Also matches any type that
// reads like a digest/report/weekly summary.
const REPORT_TYPES = new Set([
  'procurement_digest', 'cc_budget_approved_digest', 'cc_engineer_digest',
  'daily_site_report', 'daily_site_report_digest', 'bills_digest', 'bills_pipeline',
  'jmr_weekly', 'inventory_daily_report', 'inventory_low_stock', 'sched_promise_nudge',
])
export function shouldRenderCard(type: string | null | undefined): boolean {
  const t = (type ?? '').toLowerCase()
  if (REPORT_TYPES.has(t)) return true
  return /digest|weekly|report|reminders/.test(t)
}
