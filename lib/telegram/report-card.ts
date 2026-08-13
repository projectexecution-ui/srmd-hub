// Render a notification/report into a clean 1080px-wide PNG "report card" —
// the same SVG→PNG pipeline the Bills pipeline uses (@resvg/resvg-js + the
// bundled Noto Sans font). Telegram sends these as photos, which forward
// straight to WhatsApp as a shareable image.

import { Resvg } from '@resvg/resvg-js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CardSpec, CardTone } from '@/lib/telegram/card-spec'

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

// ── Rich card (CardSpec) — mirrors the HTML email layout ────────────────────
// Same visual language as lib/notifications/email-templates.ts: brand header,
// project chips, colored stat tiles, sectioned lists with bold main + muted sub
// + colored right value, and warning banners. Light theme to match the mail.

const E = {
  BRAND: '#185FA5', INK: '#111827', MUT: '#6b7280', HAIR: '#e5e7eb',
  OK: '#0f6e56', OKBG: '#e1f5ee', OKBD: '#bfe6d8',
  WARN: '#854f0b', WARNBG: '#faeeda', WARNBD: '#f0e0c2',
  DANGER: '#a32d2d', DANGERBG: '#fbeceb', DANGERBD: '#f3d7d5',
  BRANDBG: '#e8f0f8', BRANDBD: '#cfe0f0',
  NEUTBG: '#f3f4f6', NEUTBD: '#e5e7eb',
  WHITE: '#ffffff',
}
function tone(t: CardTone | undefined) {
  switch (t) {
    case 'danger': return { fg: E.DANGER, bg: E.DANGERBG, bd: E.DANGERBD }
    case 'warn':   return { fg: E.WARN,   bg: E.WARNBG,   bd: E.WARNBD }
    case 'ok':     return { fg: E.OK,     bg: E.OKBG,     bd: E.OKBD }
    case 'brand':  return { fg: E.BRAND,  bg: E.BRANDBG,  bd: E.BRANDBD }
    default:       return { fg: E.INK,    bg: E.NEUTBG,   bd: E.NEUTBD }
  }
}
function rrect(x: number, y: number, w: number, h: number, fill: string, o: { stroke?: string; rx?: number } = {}): string {
  const st = o.stroke ? ` stroke="${o.stroke}" stroke-width="1.5"` : ''
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 12}" fill="${fill}"${st}/>`
}
// Approximate character budget for a width at a given font size (Noto ~0.53em avg).
function clipPx(s: string, maxPx: number, size: number): string {
  const max = Math.max(4, Math.floor(maxPx / (size * 0.53)))
  const t = sanitize(s)
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}

export async function renderCardSpec(spec: CardSpec): Promise<Buffer> {
  const P: string[] = []
  const CW = W - PAD * 2
  let y = 0

  // Header
  P.push(rrect(PAD, 40, 46, 46, E.BRAND, { rx: 9 }))
  P.push(text(PAD + 23, 72, 'CT', { fill: E.WHITE, size: 22, weight: 700, anchor: 'middle' }))
  P.push(text(PAD + 62, 71, `CT HUB · ${sanitize(spec.brand || 'Report')}`, { fill: E.MUT, size: 24, weight: 500 }))
  if (spec.dateLabel) P.push(text(W - PAD, 71, spec.dateLabel, { fill: E.MUT, size: 22, anchor: 'end' }))
  y = 108
  P.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${E.HAIR}" stroke-width="2"/>`)
  y += 46

  // Title (wrap)
  for (const tl of wrap(spec.title, 38)) { P.push(text(PAD, y, tl, { fill: E.INK, size: 38, weight: 700 })); y += 50 }
  if (spec.subtitle) { y += 2; P.push(text(PAD, y, clipPx(spec.subtitle, CW, 25), { fill: E.MUT, size: 25 })); y += 30 }
  y += 6

  // Project chips
  if (spec.chips && spec.chips.length) {
    let cx = PAD
    const chipH = 40, gap = 10
    for (const c of spec.chips) {
      const label = sanitize(c)
      const cw = Math.min(CW, label.length * 13 + 34)
      if (cx + cw > W - PAD) { cx = PAD; y += chipH + gap }
      P.push(rrect(cx, y, cw, chipH, E.BRANDBG, { rx: 20 }))
      P.push(text(cx + 17, y + 27, clipPx(label, cw - 24, 20), { fill: E.BRAND, size: 20, weight: 500 }))
      cx += cw + gap
    }
    y += chipH + 20
  }

  // Stat tiles (up to 2 across)
  if (spec.stats && spec.stats.length) {
    const n = Math.min(spec.stats.length, 2)
    const gap = 20
    const tw = n === 2 ? (CW - gap) / 2 : CW
    const th = 148
    spec.stats.slice(0, 2).forEach((s, i) => {
      const tc = tone(s.tone)
      const x = PAD + i * (tw + gap)
      P.push(rrect(x, y, tw, th, tc.bg, { stroke: tc.bd, rx: 14 }))
      P.push(text(x + 24, y + 40, clipPx(s.label, tw - 48, 22), { fill: tc.fg, size: 22, weight: 600 }))
      P.push(text(x + 24, y + 98, clipPx(s.value, tw - 48, 48), { fill: E.INK, size: 48, weight: 700 }))
      if (s.sub) P.push(text(x + 24, y + 128, clipPx(s.sub, tw - 48, 20), { fill: E.MUT, size: 20 }))
    })
    y += th + 26
  }

  // Sections
  for (const sec of spec.sections ?? []) {
    P.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${E.HAIR}" stroke-width="2"/>`)
    y += 40
    P.push(text(PAD, y, clipPx(sec.heading, CW, 30), { fill: E.INK, size: 30, weight: 700 }))
    y += sec.sub ? 30 : 14
    if (sec.sub) { P.push(text(PAD, y, clipPx(sec.sub, CW, 22), { fill: E.MUT, size: 22 })); y += 22 }
    y += 8

    for (const r of sec.rows ?? []) {
      const rowH = r.sub ? 74 : 52
      P.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${E.HAIR}" stroke-width="1.5"/>`)
      const rightW = r.right ? 240 : 0
      P.push(text(PAD, y + 34, clipPx(r.main, CW - rightW - 16, 27), { fill: E.INK, size: 27, weight: 600 }))
      if (r.sub) P.push(text(PAD, y + 62, clipPx(r.sub, CW - 16, 21), { fill: E.MUT, size: 21 }))
      if (r.right) P.push(text(W - PAD, y + 34, sanitize(r.right), { fill: tone(r.rightTone).fg, size: 26, weight: 600, anchor: 'end' }))
      y += rowH
    }
    if (sec.more && sec.more > 0) { P.push(text(PAD, y + 30, `+ ${sec.more} more`, { fill: E.MUT, size: 22 })); y += 42 }
    if (sec.banner) {
      const bc = tone(sec.banner.tone)
      const lines = wrap(sec.banner.text, 62)
      const bh = 20 + lines.length * 32
      P.push(rrect(PAD, y, CW, bh, bc.bg, { stroke: bc.bd, rx: 10 }))
      let by = y + 34
      for (const ln of lines) { P.push(text(PAD + 18, by, clipPx(ln, CW - 36, 22), { fill: bc.fg, size: 22 })); by += 32 }
      y += bh + 12
    }
    y += 12
  }

  // Footer
  y += 8
  P.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${E.HAIR}" stroke-width="2"/>`)
  y += 40
  P.push(text(PAD, y, clipPx(spec.footer || 'CT HUB · Construction Tracking', CW, 20), { fill: '#94a3b8', size: 20 }))
  y += 34

  const totalH = y
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}"><rect x="0" y="0" width="${W}" height="${totalH}" fill="${E.WHITE}"/>${P.join('')}</svg>`
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
