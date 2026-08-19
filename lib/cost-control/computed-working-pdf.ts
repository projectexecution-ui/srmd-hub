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

export interface CwRow { sr: string; description: string; unit: string; qty: string; rate: string; amount: number }

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
    .select('row_no, description, unit, qty, rate, amount')
    .eq('working_sheet_id', wsId)
    .order('row_no')
  if (xr && xr.length) {
    return xr.map(r => ({
      sr: String(r.row_no ?? ''),
      description: (r.description as string | null) ?? '',
      unit: (r.unit as string | null) ?? '',
      qty: num(r.qty),
      rate: num(r.rate),
      amount: Number(r.amount ?? 0),
    }))
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
  return `₹${Math.round(amt / area).toLocaleString('en-IN')}/sft`
}
function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null
}

/** The computed working PDF — an approval-ready document: header + approval
 *  summary (Project budget ERP, the ask, ERP position, waiting-on, raised-by)
 *  then the itemised computation with subtotal / GST & additions / grand total. */
export function buildComputedWorkingPdf(input: ApprovalCardInput, wsCode: string, rows: CwRow[]): Buffer {
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

  // ── Line-items table ──
  const items = rows.filter(r => !isAddition(r.description))
  const additions = rows.filter(r => isAddition(r.description))
  const itemsSub = items.reduce((s, r) => s + r.amount, 0)
  const addSub = additions.reduce((s, r) => s + r.amount, 0)

  autoTable(doc, {
    startY: y + 16,
    margin: { left: M, right: M },
    head: [['#', 'Description', 'Unit', 'Qty', 'Rate', 'Amount']],
    body: rows.map(r => [r.sr, r.description, r.unit, r.qty, r.rate, inr(r.amount)]),
    styles: { font, fontStyle: 'normal', fontSize: 9, cellPadding: { top: 5, bottom: 5, left: 6, right: 6 }, overflow: 'linebreak', textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.5 }, valign: 'middle' },
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

  // ── Footer ──
  const pageH = doc.internal.pageSize.getHeight()
  doc.setDrawColor(...LINE); doc.line(M, pageH - 40, W - M, pageH - 40)
  doc.setFont(font, 'normal'); doc.setFontSize(8); doc.setTextColor(...FAINT)
  doc.text('CT HUB · Cost Control · Confidential — approver only', M, pageH - 26)
  doc.text(`Generated ${now} · figures from the uploaded working`, W - M, pageH - 26, { align: 'right' })

  return Buffer.from(doc.output('arraybuffer'))
}
