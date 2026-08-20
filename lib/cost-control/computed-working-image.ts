// Render a working sheet's Computed Working (approval summary + itemised BOQ +
// totals + approval trail) as PNG IMAGE(s), so it previews inline in Telegram /
// forwards cleanly to WhatsApp — an alternative to the PDF for a quick glance.
//
// Smart pagination: everything is packed into ONE image up to MAX_H; only when
// the content genuinely overflows does it split into a second (or third) image,
// each filled to near-max before the next starts. Same @resvg/resvg-js + Noto
// pipeline as the approval cards (so ₹ renders).

import { Resvg } from '@resvg/resvg-js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ApprovalCardInput } from '@/lib/cost-control/approval-card'
import type { CwRow, TrailEntry, CwCheck } from '@/lib/cost-control/computed-working-pdf'

const FONT_FAMILY = 'Noto Sans'
const FONT_PATH = join(process.cwd(), 'lib', 'bills-pipeline', 'fonts', 'NotoSans.ttf')

const W = 1080
const PAD = 48
const MAX_H = 3600 // comfortable single-photo height (well within Telegram limits)

const C = {
  NAVY: '#0f2a4a', GOLD: '#c19a3e', INK: '#111827', MUT: '#6b7280', FAINT: '#9ca3af',
  LINE: '#e5e7eb', STRIPE: '#f7f9fc', GTBG: '#e8eef6', PANEL: '#f7f9fc', WHITE: '#ffffff',
}

const inr = (v: number) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN')
function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function sanitize(s: string): string {
  return (s ?? '').replace(/[→⟶⇒›]/g, '>').replace(/[₹]/g, '₹') // keep ₹; swap arrows Noto lacks
}
function text(x: number, y: number, content: string, o: { fill?: string; size?: number; weight?: number; anchor?: string } = {}): string {
  const { fill = C.INK, size = 24, weight = 400, anchor = 'start' } = o
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" font-family="${FONT_FAMILY}">${esc(sanitize(content))}</text>`
}
function rect(x: number, y: number, w: number, h: number, fill: string, o: { rx?: number; stroke?: string } = {}): string {
  const st = o.stroke ? ` stroke="${o.stroke}" stroke-width="1.5"` : ''
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 0}" fill="${fill}"${st}/>`
}
// Word-wrap to ~maxChars per line.
function wrap(s: string, maxChars: number): string[] {
  const out: string[] = []
  let cur = ''
  for (const word of sanitize(s ?? '').split(/\s+/)) {
    if (!word) continue
    if ((cur ? cur.length + 1 : 0) + word.length > maxChars) {
      if (cur) out.push(cur)
      if (word.length > maxChars) { let w = word; while (w.length > maxChars) { out.push(w.slice(0, maxChars)); w = w.slice(maxChars) } cur = w }
      else cur = word
    } else cur = cur ? `${cur} ${word}` : word
  }
  if (cur) out.push(cur)
  return out.length ? out : ['']
}

// Table geometry (x = left for text cols, xr = right edge for numeric cols).
const COL = {
  sr: PAD, desc: PAD + 44, descW: 470,
  unit: PAD + 44 + 470 + 8,
  qtyR: W - PAD - 300, rateR: W - PAD - 165, amtR: W - PAD,
}
const LINE_LH = 30

interface Block { h: number; draw: (y: number) => string; kind: 'row' | 'total' | 'trailhead' | 'trail' }

export function buildComputedWorkingImages(input: ApprovalCardInput, wsCode: string, rows: CwRow[], trail: TrailEntry[] = [], check: CwCheck | null = null): Buffer[] {
  const projName = input.project.name || input.project.code || '—'
  const total = input.amount
  const ADD_RE = /\b(gst|cgst|sgst|igst|tax|cess|contingenc|freight|discount|round)/i
  const items = rows.filter(r => !ADD_RE.test(r.description))
  const additions = rows.filter(r => ADD_RE.test(r.description))
  const itemsSub = items.reduce((s, r) => s + r.amount, 0)
  const addSub = additions.reduce((s, r) => s + r.amount, 0)

  // ── Repeatable header band ──
  const HB = 128
  const headerBand = (cont: boolean): string => {
    const p: string[] = []
    p.push(rect(0, 0, W, HB, C.NAVY))
    p.push(rect(PAD, 40, 6, 48, C.GOLD, { rx: 2 }))
    p.push(text(PAD + 20, 60, 'CT HUB · COST CONTROL', { fill: C.GOLD, size: 18, weight: 600 }))
    p.push(text(PAD + 20, 96, cont ? 'Computed Working (cont.)' : 'Computed Working', { fill: C.WHITE, size: 32, weight: 700 }))
    p.push(text(W - PAD, 56, wsCode, { fill: '#c8d2e0', size: 20, anchor: 'end' }))
    p.push(text(W - PAD, 96, inr(total), { fill: C.WHITE, size: 30, weight: 700, anchor: 'end' }))
    return p.join('')
  }

  // ── Page-1 identity + approval summary (measured) ──
  const summaryFields: Array<[string, string]> = []
  if (input.showErp && input.projectErpBudget && input.projectErpBudget > 0) summaryFields.push(['Project budget (ERP)', inr(input.projectErpBudget)])
  const psftV = input.showPerSft && input.area && input.area > 0 && total ? Math.round(total / input.area) : 0
  const perSft = psftV > 0 ? ` · ₹${psftV.toLocaleString('en-IN')}/sft` : ''
  summaryFields.push(['Amount to approve', inr(total) + perSft])
  const hasErp = input.showErp && input.erp && (input.erp.budget || input.erp.wo || input.erp.paid)
  const usedPct = hasErp && input.erp && input.erp.budget > 0 ? Math.round((input.erp.paid / input.erp.budget) * 100) : null
  const erpLine = hasErp && input.erp ? `Budget ${inr(input.erp.budget)} · WO ${inr(input.erp.wo)} · Paid ${inr(input.erp.paid)}${usedPct != null ? ` (${usedPct}%)` : ''}` : ''
  const waitVal = `${input.nextActionLabel}${input.raisedBy ? ` · raised by ${input.raisedBy}` : ''}`
  const revVal = input.revision && input.revision.deltaPct != null ? `Rev ${input.revision.n} · ${input.revision.deltaPct > 0 ? '+' : ''}${input.revision.deltaPct}% vs last` : ''

  const identityH = 96
  const sumRows = 1 + (hasErp ? 1 : 0) + 1 // pair-row + erp + waiting/rev
  const summaryH = 30 + sumRows * 56 + 16
  const drawIdentity = (y: number): string => {
    const p: string[] = []
    p.push(text(PAD, y + 34, projName, { fill: C.INK, size: 30, weight: 700 }))
    p.push(text(PAD, y + 68, [input.category, input.subCategory].filter(Boolean).join('  ›  ') || '—', { fill: C.MUT, size: 22 }))
    return p.join('')
  }
  const drawSummary = (y: number): string => {
    const p: string[] = []
    p.push(rect(PAD, y, W - 2 * PAD, summaryH, C.PANEL, { rx: 10, stroke: C.LINE }))
    p.push(text(PAD + 18, y + 26, 'APPROVAL SUMMARY', { fill: C.GOLD, size: 16, weight: 600 }))
    const leftX = PAD + 18, rightX = W / 2 + 10
    const fld = (label: string, val: string, x: number, yy: number): string =>
      text(x, yy, label.toUpperCase(), { fill: C.FAINT, size: 14 }) + text(x, yy + 24, val, { fill: C.INK, size: 22 })
    let ry = y + 58
    // row 1: project budget (left) + amount (right)
    if (summaryFields.length === 2) { p.push(fld(summaryFields[0][0], summaryFields[0][1], leftX, ry)); p.push(fld(summaryFields[1][0], summaryFields[1][1], rightX, ry)) }
    else { p.push(fld(summaryFields[0][0], summaryFields[0][1], leftX, ry)) }
    ry += 56
    if (hasErp) { p.push(fld('ERP · this sub-category', erpLine, leftX, ry)); ry += 56 }
    p.push(fld('Waiting on', waitVal, leftX, ry)); if (revVal) p.push(fld('Revision', revVal, rightX, ry))
    return p.join('')
  }

  // ── Table header (repeatable) ──
  const TH = 46
  const tableHeader = (y: number): string => {
    const p: string[] = []
    p.push(rect(PAD, y, W - 2 * PAD, TH, C.NAVY, { rx: 4 }))
    p.push(text(COL.sr, y + 30, '#', { fill: C.WHITE, size: 18, weight: 600 }))
    p.push(text(COL.desc, y + 30, 'Description', { fill: C.WHITE, size: 18, weight: 600 }))
    p.push(text(COL.unit, y + 30, 'Unit', { fill: C.WHITE, size: 18, weight: 600 }))
    p.push(text(COL.qtyR, y + 30, 'Qty', { fill: C.WHITE, size: 18, weight: 600, anchor: 'end' }))
    p.push(text(COL.rateR, y + 30, 'Rate', { fill: C.WHITE, size: 18, weight: 600, anchor: 'end' }))
    p.push(text(COL.amtR, y + 30, 'Amount', { fill: C.WHITE, size: 18, weight: 600, anchor: 'end' }))
    return p.join('')
  }

  // ── Excel-check banner (page 1) ──
  const bannerInfo = check && check.total > 0 ? (() => {
    const pctM = Math.round((check.measured / check.total) * 100)
    if (check.flagged > 0) return { text: `Excel check: ${check.flagged} flagged — review · ${check.measured}/${check.total} measured (${pctM}%)`, bg: '#faeeda', fg: '#8a5a0b', mark: '!' }
    return { text: `Excel check: OK to review · ${check.measured}/${check.total} measured (${pctM}%) · nothing flagged`, bg: '#e1f5ee', fg: '#0f6e3d', mark: 'OK' }
  })() : null
  const bannerH = bannerInfo ? 52 : 0
  const drawBanner = (y: number): string => bannerInfo
    ? rect(PAD, y, W - 2 * PAD, 42, bannerInfo.bg, { rx: 8 }) + text(PAD + 18, y + 28, `${bannerInfo.mark}   ${bannerInfo.text}`, { fill: bannerInfo.fg, size: 19, weight: 600 })
    : ''

  // ── Item row blocks (with take-off, rate breakdown, flags) ──
  const rowBlocks: Block[] = rows.map((r, i) => {
    const lines = wrap(r.description, 44)
    const subs: Array<{ t: string; fill: string }> = []
    if (r.takeoff) subs.push({ t: `· from ${r.takeoff}`, fill: C.FAINT })
    if (r.flag) subs.push({ t: `! ${r.flag.reason}`, fill: '#8a5a0b' })
    const bd = r.breakdown ?? []
    // Row height is whichever side is taller — description+sub-lines (left) or
    // amount + breakdown components (right).
    const h = Math.max(52, Math.max(lines.length + subs.length, 1 + bd.length) * LINE_LH + 22)
    const add = ADD_RE.test(r.description)
    return {
      kind: 'row', h,
      draw: (y: number) => {
        const p: string[] = []
        if (r.flag) p.push(rect(PAD, y, W - 2 * PAD, h, '#fdf6ea'))
        else if (i % 2 === 1) p.push(rect(PAD, y, W - 2 * PAD, h, C.STRIPE))
        const tc = add ? C.MUT : C.INK
        p.push(text(COL.sr, y + 32, r.sr, { fill: C.FAINT, size: 20 }))
        let ly = y + 32
        lines.forEach(ln => { p.push(text(COL.desc, ly, ln, { fill: tc, size: 20 })); ly += LINE_LH })
        subs.forEach(s => { p.push(text(COL.desc, ly, s.t, { fill: s.fill, size: 16 })); ly += LINE_LH })
        p.push(text(COL.unit, y + 32, r.unit, { fill: C.MUT, size: 19 }))
        p.push(text(COL.qtyR, y + 32, r.qty, { fill: tc, size: 20, anchor: 'end' }))
        p.push(text(COL.rateR, y + 32, r.rate, { fill: tc, size: 20, anchor: 'end' }))
        p.push(text(COL.amtR, y + 32, inr(r.amount), { fill: C.INK, size: 20, anchor: 'end' }))
        // Rate split (Material / Labour / M+L) — right-aligned under the amount.
        bd.forEach((b, k) => p.push(text(COL.amtR, y + 32 + (k + 1) * LINE_LH, `${b.label} ₹${Math.round(b.value).toLocaleString('en-IN')}`, { fill: C.FAINT, size: 16, anchor: 'end' })))
        p.push(`<line x1="${PAD}" y1="${y + h}" x2="${W - PAD}" y2="${y + h}" stroke="${C.LINE}" stroke-width="1"/>`)
        return p.join('')
      },
    }
  })

  // ── Totals block ──
  const totalsH = 24 + (additions.length ? 2 * 34 : 0) + 52
  const totalsBlock: Block = {
    kind: 'total', h: totalsH,
    draw: (y: number) => {
      const p: string[] = []
      const lx = W - PAD - 470
      let ty = y + 24
      if (additions.length) {
        p.push(text(lx, ty, 'Items subtotal', { fill: C.MUT, size: 20 })); p.push(text(W - PAD, ty, inr(itemsSub), { fill: C.INK, size: 20, anchor: 'end' })); ty += 34
        p.push(text(lx, ty, 'GST & additions', { fill: C.MUT, size: 20 })); p.push(text(W - PAD, ty, inr(addSub), { fill: C.INK, size: 20, anchor: 'end' })); ty += 34
      }
      p.push(rect(lx - 16, ty - 8, (W - PAD) - (lx - 16), 46, C.GTBG, { rx: 6 }))
      p.push(text(lx, ty + 24, 'Grand Total', { fill: C.NAVY, size: 24, weight: 700 }))
      p.push(text(W - PAD, ty + 24, inr(total), { fill: C.NAVY, size: 26, weight: 700, anchor: 'end' }))
      return p.join('')
    },
  }

  // ── Trail blocks ──
  const trailHeadH = 50
  const trailHeadBlock: Block = { kind: 'trailhead', h: trailHeadH, draw: (y: number) => text(PAD, y + 34, 'Approval Trail & Comments', { fill: C.NAVY, size: 24, weight: 700 }) }
  const trailBlocks: Block[] = trail.map((t, i) => {
    const cLines = wrap(t.comment, 52)
    const h = Math.max(56, cLines.length * 26 + 42)
    return {
      kind: 'trail', h,
      draw: (y: number) => {
        const p: string[] = []
        if (i % 2 === 1) p.push(rect(PAD, y, W - 2 * PAD, h, C.STRIPE))
        p.push(text(PAD, y + 26, `${t.when}  ·  ${t.who}`, { fill: C.MUT, size: 17 }))
        p.push(text(W - PAD, y + 26, t.action, { fill: C.NAVY, size: 18, weight: 600, anchor: 'end' }))
        cLines.forEach((ln, k) => p.push(text(PAD + 6, y + 50 + k * 26, ln, { fill: C.INK, size: 19 })))
        p.push(`<line x1="${PAD}" y1="${y + h}" x2="${W - PAD}" y2="${y + h}" stroke="${C.LINE}" stroke-width="1"/>`)
        return p.join('')
      },
    }
  })

  // ── Flow the blocks into pages ──
  const FOOTER = 56
  const bodyBlocks: Block[] = [...rowBlocks, totalsBlock, ...(trail.length ? [trailHeadBlock, ...trailBlocks] : [])]

  const pages: Array<{ parts: string[]; y: number }> = []
  let pg: { parts: string[]; y: number } = { parts: [], y: 0 }
  let firstPage = true
  const openPage = (withTableHeader: boolean) => {
    pg = { parts: [], y: 0 }
    pg.parts.push(headerBand(!firstPage))
    pg.y = HB
    if (firstPage) {
      pg.parts.push(drawIdentity(pg.y)); pg.y += identityH
      pg.parts.push(drawSummary(pg.y)); pg.y += summaryH + 12
      pg.parts.push(drawBanner(pg.y)); pg.y += bannerH
    }
    if (withTableHeader) { pg.parts.push(tableHeader(pg.y)); pg.y += TH }
    pages.push(pg)
    firstPage = false
  }
  openPage(true)
  let lastKind: Block['kind'] = 'row'
  for (const b of bodyBlocks) {
    if (pg.y + b.h + FOOTER > MAX_H) {
      // Rows continue with a table header; trail/totals continue plain.
      openPage(b.kind === 'row')
    } else if (b.kind === 'row' && lastKind !== 'row' && lastKind !== undefined) {
      // (rows always contiguous; no-op)
    }
    pg.parts.push(b.draw(pg.y)); pg.y += b.h
    lastKind = b.kind
  }

  // ── Render each page to PNG ──
  const hasFont = existsSync(FONT_PATH)
  const total_pages = pages.length
  return pages.map((page, idx) => {
    const H = Math.min(MAX_H, page.y + FOOTER)
    const footer = `<line x1="0" y1="${H - FOOTER}" x2="${W}" y2="${H - FOOTER}" stroke="${C.LINE}" stroke-width="1.5"/>`
      + text(PAD, H - 20, 'CT HUB · Cost Control · Confidential — approver only', { fill: C.FAINT, size: 16 })
      + text(W - PAD, H - 20, total_pages > 1 ? `Page ${idx + 1} of ${total_pages}` : 'figures from the uploaded working', { fill: C.FAINT, size: 16, anchor: 'end' })
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${C.WHITE}"/>${page.parts.join('')}${footer}</svg>`
    const resvg = new Resvg(svg, { font: { loadSystemFonts: !hasFont, fontFiles: hasFont ? [FONT_PATH] : [], defaultFontFamily: FONT_FAMILY }, fitTo: { mode: 'width', value: W } })
    return Buffer.from(resvg.render().asPng())
  })
}
