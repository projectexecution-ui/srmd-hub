// Render a working sheet's COMPUTED working — the parsed BOQ line items the app
// computed from the uploaded Excel (Sr · Description · Unit · Qty · Rate ·
// Amount, with the grand total) — as a clean PDF. Attached to the Telegram
// approval card so an approver can review the actual computation on their phone
// and approve, not just the raw source Excel.
//
// Source: cc_excel_rows (Excel-summary sheets) or, as a fallback, the typed
// cc_working_sheet_items (line-item sheets). Noto Sans is embedded so ₹ + Indian
// digit grouping render (jsPDF's built-in Helvetica has no ₹ glyph).

import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface CwRow { sr: string; description: string; unit: string; qty: string; rate: string; amount: number }
export interface ComputedWorkingHeader {
  wsCode: string
  project: string
  category: string
  subCategory: string
  total: number
}

const FONT_PATH = join(process.cwd(), 'lib', 'bills-pipeline', 'fonts', 'NotoSans.ttf')
let FONT_B64: string | null = null

const inr = (v: number) => '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN')
function num(v: unknown, dp = 2): string {
  if (v == null) return ''
  const n = Number(v)
  if (!isFinite(n) || n === 0) return ''
  return n.toLocaleString('en-IN', { maximumFractionDigits: dp })
}

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
  return 'Noto'
}

export function buildComputedWorkingPdf(h: ComputedWorkingHeader, rows: CwRow[]): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const font = useFont(doc)
  const M = 40
  const W = doc.internal.pageSize.getWidth()

  // Header band
  doc.setFillColor(15, 42, 74)
  doc.rect(0, 0, W, 68, 'F')
  doc.setFont(font, 'normal')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(15)
  doc.text('Computed Working', M, 30)
  doc.setFontSize(10)
  doc.setTextColor(200, 210, 224)
  doc.text(h.wsCode, M, 48)
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(12)
  doc.text(inr(h.total), W - M, 40, { align: 'right' })

  // Identity
  let y = 90
  doc.setTextColor(55, 65, 81)
  doc.setFontSize(10)
  doc.text(`Project:  ${h.project}`, M, y); y += 16
  doc.text(`Category:  ${h.category}`, M, y)
  doc.text(`Sub-category:  ${h.subCategory}`, W / 2, y); y += 6

  autoTable(doc, {
    startY: y + 10,
    margin: { left: M, right: M },
    head: [['Sr', 'Description', 'Unit', 'Qty', 'Rate', 'Amount']],
    body: rows.map(r => [r.sr, r.description, r.unit, r.qty, r.rate, inr(r.amount)]),
    foot: [['', 'Grand total', '', '', '', inr(h.total)]],
    styles: { font, fontSize: 9, cellPadding: 4, overflow: 'linebreak', textColor: [30, 30, 30], lineColor: [230, 232, 236], lineWidth: 0.5 },
    headStyles: { fillColor: [237, 240, 245], textColor: [90, 90, 90], fontSize: 8.5, halign: 'left' },
    footStyles: { fillColor: [226, 232, 242], textColor: [15, 42, 74], halign: 'right', fontSize: 9.5 },
    columnStyles: {
      0: { cellWidth: 26, halign: 'right' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 42 },
      3: { cellWidth: 62, halign: 'right' },
      4: { cellWidth: 50, halign: 'right' },
      5: { cellWidth: 84, halign: 'right' },
    },
  })

  return Buffer.from(doc.output('arraybuffer'))
}
