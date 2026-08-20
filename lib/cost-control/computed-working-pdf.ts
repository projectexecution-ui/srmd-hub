// Render a working sheet's COMPUTED working — the parsed BOQ line items the app
// computed from the uploaded Excel (Sr · Description · Unit · Qty · Rate ·
// Amount, with the subtotal / GST&additions / grand total) — as a clean,
// professional PDF. Attached to the Telegram approval card so an approver can
// review the actual computation on their phone and approve, not just the raw
// source Excel.
//
// Source: cc_excel_rows (Excel-summary sheets) or, as a fallback, the typed
// cc_working_sheet_items (line-item sheets). Noto Sans is embedded for BOTH the
// normal AND bold weights — jsPDF's built-in Helvetica has no ₹ glyph, and
// autoTable's header/total cells default to bold, so without the bold face the
// grand total would render ₹ as tofu boxes.

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApprovalCardInput } from '@/lib/cost-control/approval-card'

export interface CwRow {
  sr: string; description: string; unit: string; qty: string; rate: string; amount: number
  /** Take-off provenance — where the qty came from, e.g. "Working Sheet!G15". */
  takeoff?: string
  /** Rate split, e.g. [{label:'M+L', value:20000}] / [{label:'Material',…},{label:'Labour',…}].
   *  Shown right-aligned against the row, one component per line. */
  breakdown?: Array<{ label: string; value: number }>
  /** A flag raised by the Excel check on this row (null = clean). */
  flag?: { severity: string; reason: string } | null
}
export interface TrailEntry { when: string; who: string; action: string; comment: string }
/** The Excel-check scorecard: how many qtys were measured vs estimated, and how
 *  many rows the check flagged. */
export interface CwCheck { measured: number; estimated: number; flagged: number; total: number; narrative: string | null }

const FONT_PATH = join(process.cwd(), 'lib', 'bills-pipeline', 'fonts', 'NotoSans.ttf')
let FONT_B64: string | null = null

type RGB = [number, number, number]
const NAVY: RGB = [15, 42, 74]
const GOLD: RGB = [193, 154, 62]
const INK: RGB = [17, 24, 39]
const MUT: RGB = [107, 114, 128]
const FAINT: RGB = [156, 163, 175]
const LINE: RGB = [226, 232, 240]
const STRIPE: RGB = [247, 249, 252]
const GT_BG: RGB = [232, 238, 246]
const WHITE: RGB = [255, 255, 255]

const inr = (v: number) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN')
function num(v: unknown, dp = 2): string {
  if (v == null) return ''
  const n = Number(v)
  if (!isFinite(n) || n === 0) return ''
  return n.toLocaleString('en-IN', { maximumFractionDigits: dp })
}

// GST / contingency / tax / freight / rounding rows are "additions", split out
// from the item subtotal in the totals block (mirrors the on-screen working).
const ADDITION_RE = /\b(gst|cgst|sgst|igst|utgst|tax|cess|tds|tcs|vat|contingenc|freight|carriage|packing|discount|round)/i
const isAddition = (desc: string) => ADDITION_RE.test(desc || '')

/** Load the computed line items for a sheet — Excel rows first, then the typed
 *  line items. Returns [] when neither exists (e.g. a thumbrule estimate). */
export async function loadComputedWorkingRows(svc: SupabaseClient, wsId: string): Promise<CwRow[]> {
  const { data: xr } = await svc
    .from('cc_excel_rows')
    .select('row_no, description, unit, qty, rate, amount, qty_formula, source_sheet, source_cell, rate_breakdown, flag, flag_reason, flag_severity')
    .eq('working_sheet_id', wsId)
    .order('row_no')
  if (xr && xr.length) {
    return xr.map(r => {
      const takeoff = r.source_sheet && r.source_cell
        ? `${r.source_sheet}!${r.source_cell}`
        : (r.qty_formula ? String(r.qty_formula).replace(/'/g, '') : '')
      const rb = Array.isArray(r.rate_breakdown) ? (r.rate_breakdown as Array<{ label?: string; value?: number }>) : []
      const breakdown = rb.filter(b => b && (b.label || b.value != null)).map(b => ({ label: String(b.label ?? ''), value: Number(b.value) || 0 }))
      return {
        sr: String(r.row_no ?? ''),
        description: (r.description as string | null) ?? '',
        unit: (r.unit as string | null) ?? '',
        qty: num(r.qty),
        rate: num(r.rate),
        amount: Number(r.amount ?? 0),
        takeoff: takeoff || undefined,
        breakdown: breakdown.length ? breakdown : undefined,
        flag: r.flag ? { severity: (r.flag_severity as string) ?? '', reason: (r.flag_reason as string) ?? String(r.flag) } : null,
      }
    })
  }
  const { data: li } = await svc
    .from('cc_working_sheet_items')
    .select('sr_no, description, uom, qty, rate, total_amount')
    .eq('working_sheet_id', wsId)
    .order('sr_no')
  return (li ?? []).map(r => ({
    sr: String(r.sr_no ?? ''),
    description: (r.description as string | null) ?? '',
    unit: (r.uom as string | null) ?? '',
    qty: num(r.qty),
    rate: num(r.rate),
    amount: Number(r.total_amount ?? 0),
  }))
}

/** The Excel-check scorecard for a sheet: measured vs estimated qtys + flags. */
export async function loadCheckSummary(svc: SupabaseClient, wsId: string): Promise<CwCheck | null> {
  const [{ data: rows }, { data: ws }] = await Promise.all([
    svc.from('cc_excel_rows').select('qty, qty_basis, flag').eq('working_sheet_id', wsId),
    svc.from('cc_working_sheets').select('flag_summary').eq('id', wsId).maybeSingle(),
  ])
  if (!rows || !rows.length) return null
  let measured = 0, estimated = 0, flagged = 0
  for (const r of rows) {
    if (r.flag) flagged++
    if (r.qty == null) continue
    if (r.qty_basis === 'measured') measured++
    else estimated++
  }
  const fs = (ws?.flag_summary as { narrative?: string | null; flagged_rows?: number } | null) ?? null
  if (fs && typeof fs.flagged_rows === 'number') flagged = fs.flagged_rows
  return { measured, estimated, flagged, total: measured + estimated, narrative: fs?.narrative ?? null }
}

// ── Approval trail (audit history + comments) ──────────────────────────────
const STAGE_ACTION: Record<string, string> = {
  'submitted>ph_approved': 'Project Head signed',
  'ph_approved>atm_approved': 'Atm Head signed',
  'atm_approved>approved': 'Trustee released',
  'atm_approved>partially_approved': 'Trustee part-released',
  'partially_approved>approved': 'Trustee released (balance)',
}
function stageAction(from: string, to: string): string {
  if (to === 'returned') return 'Returned'
  return STAGE_ACTION[`${from}>${to}`] ?? `${from} → ${to}`
}
function fmtDT(iso: string): string {
  const t = Date.parse(iso)
  if (!isFinite(t)) return ''
  return new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
}

/** Load the approval trail + comment thread for a sheet, oldest first — so the
 *  final approver sees who signed off, when, and with what remark. */
export async function loadApprovalTrail(svc: SupabaseClient, wsId: string): Promise<TrailEntry[]> {
  const [{ data: ev }, { data: cm }] = await Promise.all([
    svc.from('approval_events').select('from_stage, to_stage, comment, created_at, actor_id')
      .eq('doc_id', wsId).eq('module_slug', 'cost-control').order('created_at'),
    svc.from('cc_ws_comments').select('author_id, body, created_at').eq('ws_id', wsId).order('created_at'),
  ])
  const ids = new Set<string>()
  for (const e of ev ?? []) if (e.actor_id) ids.add(e.actor_id as string)
  for (const c of cm ?? []) if (c.author_id) ids.add(c.author_id as string)
  const names = new Map<string, string>()
  if (ids.size) {
    const { data: profs } = await svc.from('profiles').select('id, full_name, name').in('id', [...ids])
    for (const p of profs ?? []) names.set(p.id as string, (p.full_name as string) || (p.name as string) || '—')
  }
  const rows: Array<{ ts: string } & TrailEntry> = []
  for (const e of ev ?? []) rows.push({
    ts: e.created_at as string, when: fmtDT(e.created_at as string),
    who: names.get(e.actor_id as string) ?? '—',
    action: stageAction(e.from_stage as string, e.to_stage as string), comment: (e.comment as string) ?? '',
  })
  for (const c of cm ?? []) rows.push({
    ts: c.created_at as string, when: fmtDT(c.created_at as string),
    who: names.get(c.author_id as string) ?? '—', action: 'Comment', comment: (c.body as string) ?? '',
  })
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
  return rows.map(({ when, who, action, comment }) => ({ when, who, action, comment }))
}

function useFont(doc: jsPDF): string {
  if (!existsSync(FONT_PATH)) return 'helvetica'
  if (FONT_B64 == null) FONT_B64 = readFileSync(FONT_PATH).toString('base64')
  doc.addFileToVFS('NotoSans.ttf', FONT_B64)
  doc.addFont('NotoSans.ttf', 'Noto', 'normal')
  doc.addFont('NotoSans.ttf', 'Noto', 'bold') // same file (no bold weight) — emphasis via fills/size
  doc.setFont('Noto', 'normal')
  return 'Noto'
}

function perSftStr(amt: number, area: number | null | undefined): string {
  if (!area || area <= 0 || !amt) return ''
  const v = Math.round(amt / area)
  return v > 0 ? `₹${v.toLocaleString('en-IN')}/sft` : ''
}
function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

/** The computed working PDF — an approval-ready document: header + approval
 *  summary (Project budget ERP, the ask, ERP position, waiting-on, raised-by)
 *  then the itemised computation with subtotal / GST & additions / grand total. */
// Excel-check banner text + colour from the scorecard.
function checkBanner(check: CwCheck | null): { text: string; bg: RGB; fg: RGB } | null {
  if (!check || check.total === 0) return null
  const pctM = check.total > 0 ? Math.round((check.measured / check.total) * 100) : 0
  if (check.flagged > 0) {
    return { text: `Excel check: ${check.flagged} flagged — review · ${check.measured}/${check.total} measured (${pctM}%)`, bg: [250, 238, 218], fg: [138, 90, 11] }
  }
  return { text: `Excel check: OK to review · ${check.measured}/${check.total} measured (${pctM}%) · nothing flagged`, bg: [225, 245, 238], fg: [15, 111, 61] }
}

export function buildComputedWorkingPdf(input: ApprovalCardInput, wsCode: string, rows: CwRow[], trail: TrailEntry[] = [], check: CwCheck | null = null): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const font = useFont(doc)
  const M = 40
  const W = doc.internal.pageSize.getWidth()
  const now = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const projName = input.project.name || input.project.code || '—'
  const total = input.amount

  // ── Header band ──
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 76, 'F')
  doc.setFillColor(...GOLD); doc.rect(M, 24, 4, 30, 'F')
  doc.setFont(font, 'normal')
  doc.setTextColor(...GOLD); doc.setFontSize(9); doc.text('CT HUB · COST CONTROL', M + 14, 33)
  doc.setTextColor(...WHITE); doc.setFontSize(16); doc.text('Computed Working', M + 14, 55)
  doc.setTextColor(200, 210, 224); doc.setFontSize(9); doc.text(wsCode, W - M, 32, { align: 'right' })
  doc.setTextColor(...WHITE); doc.setFontSize(14); doc.text(inr(total), W - M, 55, { align: 'right' })

  // ── Identity ──
  let y = 100
  doc.setTextColor(...INK); doc.setFontSize(12.5); doc.text(projName, M, y)
  y += 16
  doc.setTextColor(...MUT); doc.setFontSize(10)
  const idParts = [input.category, input.subCategory].filter(Boolean).join('   ›   ')
  doc.text(idParts || '—', M, y)

  // ── Approval summary box ──
  const leftX = M + 14
  const rightX = W / 2 + 8
  const field = (label: string, value: string, x: number, yy: number) => {
    doc.setFont(font, 'normal'); doc.setFontSize(7.5); doc.setTextColor(...FAINT)
    doc.text(label.toUpperCase(), x, yy)
    doc.setFontSize(10.5); doc.setTextColor(...INK)
    doc.text(value || '—', x, yy + 13)
  }
  const rev = input.revision && input.revision.deltaPct != null
    ? `Rev ${input.revision.n} · ${input.revision.deltaPct > 0 ? '+' : ''}${input.revision.deltaPct}% vs last`
    : null
  const showErp = input.showErp
  const hasErp = showErp && input.erp && (input.erp.budget || input.erp.wo || input.erp.paid)

  let by = y + 22
  const boxTop = by - 4
  // reserve height: heading + row A + (erp row) + waiting row
  const boxH = 30 + 32 + (hasErp ? 26 : 0) + 32
  doc.setFillColor(247, 249, 252); doc.roundedRect(M, boxTop, W - 2 * M, boxH, 5, 5, 'F')
  doc.setDrawColor(...LINE); doc.roundedRect(M, boxTop, W - 2 * M, boxH, 5, 5, 'S')

  by += 14
  doc.setFont(font, 'normal'); doc.setFontSize(8); doc.setTextColor(...GOLD)
  doc.text('APPROVAL SUMMARY', leftX, by)
  by += 18
  if (showErp && input.projectErpBudget && input.projectErpBudget > 0) {
    field('Project budget (ERP)', inr(input.projectErpBudget), leftX, by)
  }
  const askExtra = input.showPerSft && perSftStr(total, input.area) ? ` · ${perSftStr(total, input.area)}` : ''
  field('Amount to approve', inr(total) + askExtra, rightX, by)
  by += 30
  if (hasErp && input.erp) {
    const up = pct(input.erp.paid, input.erp.budget)
    field('ERP · this sub-category',
      `Budget ${inr(input.erp.budget)} · WO ${inr(input.erp.wo)} · Paid ${inr(input.erp.paid)}${up != null ? ` (${up}%)` : ''}`,
      leftX, by)
    by += 26
  }
  field('Waiting on', `${input.nextActionLabel}${input.raisedBy ? ` · raised by ${input.raisedBy}` : ''}`, leftX, by)
  if (rev) field('Revision', rev, rightX, by)
  y = boxTop + boxH

  // ── Excel-check banner ──
  const banner = checkBanner(check)
  if (banner) {
    y += 12
    doc.setFillColor(...banner.bg); doc.roundedRect(M, y, W - 2 * M, 22, 4, 4, 'F')
    doc.setFont(font, 'normal'); doc.setFontSize(9); doc.setTextColor(...banner.fg)
    doc.text((check!.flagged > 0 ? '! ' : 'OK  ') + banner.text, M + 12, y + 15)
    y += 22
  }

  // ── Line-items table ──
  const items = rows.filter(r => !isAddition(r.description))
  const additions = rows.filter(r => isAddition(r.description))
  const itemsSub = items.reduce((s, r) => s + r.amount, 0)
  const addSub = additions.reduce((s, r) => s + r.amount, 0)

  autoTable(doc, {
    startY: y + 16,
    margin: { left: M, right: M },
    head: [['#', 'Description', 'Unit', 'Qty', 'Rate', 'Amount']],
    body: rows.map(r => [
      r.sr,
      r.description + (r.takeoff ? `\n· from ${r.takeoff}` : '') + (r.flag ? `\n! ${r.flag.reason}` : ''),
      r.unit,
      r.qty,
      r.rate,
      inr(r.amount) + (r.breakdown ? r.breakdown.map(b => `\n${b.label} ₹${Math.round(b.value).toLocaleString('en-IN')}`).join('') : ''),
    ]),
    styles: { font, fontStyle: 'normal', fontSize: 9, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, overflow: 'linebreak', textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.5 }, valign: 'top' },
    headStyles: { font, fontStyle: 'normal', fillColor: NAVY, textColor: WHITE, fontSize: 8.5, halign: 'left', cellPadding: { top: 7, bottom: 7, left: 6, right: 6 } },
    alternateRowStyles: { fillColor: STRIPE },
    columnStyles: {
      0: { cellWidth: 24, halign: 'right', textColor: FAINT },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 44, halign: 'center', textColor: MUT },
      3: { cellWidth: 66, halign: 'right' },
      4: { cellWidth: 58, halign: 'right' },
      5: { cellWidth: 90, halign: 'right' },
    },
    didParseCell: (d) => {
      if (d.section !== 'body') return
      const r = rows[d.row.index]
      // GST / contingency rows read as muted "additions", except the amount.
      if (isAddition(r.description) && d.column.index !== 5) d.cell.styles.textColor = MUT
      // Flagged rows get an amber tint so the approver can spot them.
      if (r.flag) d.cell.styles.fillColor = [252, 246, 235]
    },
  })

  // ── Totals block ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fy = ((doc as any).lastAutoTable?.finalY ?? y + 40) + 16
  const labelX = W - M - 230
  const drawTotal = (label: string, val: number, muted = false) => {
    doc.setFont(font, 'normal'); doc.setFontSize(9.5)
    doc.setTextColor(...(muted ? MUT : INK)); doc.text(label, labelX, fy)
    doc.setTextColor(...INK); doc.text(inr(val), W - M, fy, { align: 'right' })
    fy += 17
  }
  if (additions.length > 0) {
    drawTotal('Items subtotal', itemsSub, true)
    drawTotal('GST & additions', addSub, true)
  }
  // Grand total — highlighted band.
  doc.setFillColor(...GT_BG); doc.roundedRect(labelX - 12, fy - 12, (W - M) - (labelX - 12), 26, 3, 3, 'F')
  doc.setFont(font, 'normal'); doc.setFontSize(11.5)
  doc.setTextColor(...NAVY); doc.text('Grand Total', labelX, fy + 4)
  doc.setFontSize(12.5); doc.text(inr(total), W - M, fy + 4, { align: 'right' })
  fy += 34

  // ── Approval trail & comments (auto-paginates) ──
  if (trail.length) {
    doc.setFont(font, 'normal'); doc.setFontSize(10.5); doc.setTextColor(...NAVY)
    doc.text('Approval Trail & Comments', M, fy + 6)
    autoTable(doc, {
      startY: fy + 12,
      margin: { left: M, right: M },
      head: [['When', 'Stage', 'By', 'Remark']],
      body: trail.map(t => [t.when, t.action, t.who, t.comment]),
      styles: { font, fontStyle: 'normal', fontSize: 8.5, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, overflow: 'linebreak', textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.5 }, valign: 'top' },
      headStyles: { font, fontStyle: 'normal', fillColor: [237, 240, 245], textColor: MUT, fontSize: 8, halign: 'left' },
      alternateRowStyles: { fillColor: STRIPE },
      columnStyles: { 0: { cellWidth: 84 }, 1: { cellWidth: 104, textColor: NAVY }, 2: { cellWidth: 92 }, 3: { cellWidth: 'auto' } },
    })
  }

  // ── Footer ──
  const pageH = doc.internal.pageSize.getHeight()
  doc.setDrawColor(...LINE); doc.line(M, pageH - 40, W - M, pageH - 40)
  doc.setFont(font, 'normal'); doc.setFontSize(8); doc.setTextColor(...FAINT)
  doc.text('CT HUB · Cost Control · Confidential — approver only', M, pageH - 26)
  doc.text(`Generated ${now} · figures from the uploaded working`, W - M, pageH - 26, { align: 'right' })

  return Buffer.from(doc.output('arraybuffer'))
}
