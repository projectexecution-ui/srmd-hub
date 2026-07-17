// Strict, position-based parser for the standard BOQ template. When a file
// carries our _meta marker we trust its fixed column layout and parse by
// COLUMN INDEX — no fuzzy header matching, no total-ladder guessing. Every
// figure is RECOMPUTED (Rate = Material+Installation+M+L, Amount = Qty×Rate,
// the whole ladder) so a tampered formula or stale cache can never corrupt a
// number. Pure (AoA in, plain objects out) so vitest covers it on fixtures.

import {
  COL, BOQ_UNITS, BOQ_META_SHEET,
  readMetaFromAoa, isBoqTemplateMeta,
} from './boq-template'

export interface TemplateRow {
  row_no: number            // 1-based sequence among ITEM rows
  aoa_row_idx: number
  sr: number | null
  description: string | null
  unit: string | null
  qty: number | null
  material: number | null
  installation: number | null
  ml: number | null
  rate: number              // recomputed = material+installation+ml
  amount: number            // recomputed = qty*rate
  remarks: string | null
  kind: 'item' | 'heading' | 'blank'
  errors: string[]
  warnings: string[]
}

export interface TemplateLadder {
  subtotal: number
  contingencyPct: number | null
  contingency: number
  gstPct: number | null
  gst: number
  grandTotal: number          // recomputed subtotal+contingency+gst
  statedGrandTotal: number | null  // the sheet's own grand-total cell (cached)
}

export interface TemplateParseResult {
  isTemplate: boolean
  meta: Record<string, string>
  headerRowIdx: number | null
  rows: TemplateRow[]         // items + headings, in sheet order
  itemRows: TemplateRow[]     // kind === 'item' only
  ladder: TemplateLadder | null
  reconciled: boolean
  reconcileDiff: number       // grandTotal − statedGrandTotal (0 when none)
  errorCount: number
  errors: string[]            // sheet-level
}

export interface SheetAoa { name: string; aoa: unknown[][] }

const RECONCILE_TOLERANCE = 0.005 // 0.5%

export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

function cellStr(row: unknown[], c: number): string | null {
  const v = row?.[c]
  if (v == null) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

/** Detect our template + pull the trusted meta from the very-hidden sheet. */
export function detectTemplate(sheets: SheetAoa[]): { isTemplate: boolean; meta: Record<string, string> } {
  const metaSheet = sheets.find(s => s.name === BOQ_META_SHEET)
  if (!metaSheet) return { isTemplate: false, meta: {} }
  const meta = readMetaFromAoa(metaSheet.aoa)
  return { isTemplate: isBoqTemplateMeta(meta), meta }
}

const LADDER_RE = /\b(sub\s*total|contingency|grand\s*total)\b|^gst$/i
function ladderKind(text: string): 'subtotal' | 'contingency' | 'gst' | 'grand' | null {
  const s = text.toLowerCase()
  if (/grand\s*total/.test(s)) return 'grand'
  if (/sub\s*total/.test(s)) return 'subtotal'
  if (/contingency/.test(s)) return 'contingency'
  if (/^gst\b/.test(s) || /\bgst\b/.test(s)) return 'gst'
  return null
}

function findHeaderRow(aoa: unknown[][]): number {
  for (let i = 0; i < Math.min(aoa.length, 25); i++) {
    const r = aoa[i] ?? []
    const desc = cellStr(r, COL.description)?.toLowerCase()
    const qty = cellStr(r, COL.qty)?.toLowerCase()
    if (desc === 'description' && qty === 'qty') return i
  }
  return -1
}

const UNIT_SET = new Set(BOQ_UNITS.map(u => u.toLowerCase()))

export interface ItemFields {
  description: string | null
  unit: string | null
  qty: number | null
  material: number | null
  installation: number | null
  ml: number | null
}

/** The single source of truth for row math + validation — used by both the
 *  upload parser and the live verify-and-fix grid, so what the engineer sees
 *  while editing is exactly what gets stored. */
export function evaluateItem(f: ItemFields): { rate: number; amount: number; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const desc = f.description?.trim()
  if (!desc) errors.push('Description is required')
  if ((f.material != null || f.installation != null) && f.ml != null) {
    errors.push('Filled both the split (Material / Installation) and the combined M+L — use one side only')
  }
  if (f.qty == null) errors.push('Quantity is missing')
  if (f.unit && !UNIT_SET.has(f.unit.trim().toLowerCase())) warnings.push(`Unit "${f.unit}" is not a standard unit`)
  const rate = (f.material ?? 0) + (f.installation ?? 0) + (f.ml ?? 0)
  if (rate === 0) warnings.push('Rate is zero — enter Material/Installation or M+L (or mark it a provisional item)')
  const amount = (f.qty ?? 0) * rate
  return { rate, amount, errors, warnings }
}

/** Recompute the totals ladder from item amounts + the two percentages. */
export function computeLadder(
  itemAmounts: number[], contingencyPct: number | null, gstPct: number | null,
): { subtotal: number; contingency: number; gst: number; grandTotal: number } {
  const subtotal = itemAmounts.reduce((s, a) => s + a, 0)
  const contingency = contingencyPct != null ? Math.round(subtotal * contingencyPct / 100) : 0
  const gst = gstPct != null ? Math.round((subtotal + contingency) * gstPct / 100) : 0
  return { subtotal, contingency, gst, grandTotal: subtotal + contingency + gst }
}

/** Parse the visible BOQ sheet of a standard-template workbook. */
export function parseTemplateSheet(boqAoa: unknown[][], meta: Record<string, string> = {}): TemplateParseResult {
  const errors: string[] = []
  const headerRowIdx = findHeaderRow(boqAoa)
  if (headerRowIdx < 0) {
    return {
      isTemplate: true, meta, headerRowIdx: null, rows: [], itemRows: [],
      ladder: null, reconciled: false, reconcileDiff: 0,
      errorCount: 1, errors: ['Could not find the standard header row (Description / Qty). Did you keep the template layout?'],
    }
  }

  const rows: TemplateRow[] = []
  let seq = 0
  let statedGrandTotal: number | null = null
  let contingencyPct: number | null = null
  let gstPct: number | null = null
  let sawLadder = false

  for (let i = headerRowIdx + 1; i < boqAoa.length; i++) {
    const r = boqAoa[i] ?? []
    const desc = cellStr(r, COL.description)
    const mlLabel = cellStr(r, COL.ml)      // "Subtotal"/"GRAND TOTAL" live here
    const labelForLadder = [desc, mlLabel].filter(Boolean).join(' ')

    // Ladder rows — capture the %/stated total, don't treat as items.
    if (labelForLadder && LADDER_RE.test(labelForLadder)) {
      sawLadder = true
      const kind = ladderKind(labelForLadder)
      if (kind === 'contingency') contingencyPct = toNum(r[COL.rate])
      else if (kind === 'gst') gstPct = toNum(r[COL.rate])
      else if (kind === 'grand') statedGrandTotal = toNum(r[COL.amount])
      continue
    }

    const sr = toNum(r[COL.sr])
    const unit = cellStr(r, COL.unit)
    const qty = toNum(r[COL.qty])
    const material = toNum(r[COL.material])
    const installation = toNum(r[COL.installation])
    const ml = toNum(r[COL.ml])
    const remarks = cellStr(r, COL.remarks)

    const hasAnyNum = qty != null || material != null || installation != null || ml != null
    // Truly blank row → skip silently.
    if (!desc && !hasAnyNum) continue

    // Heading row: a description with no numbers at all.
    if (desc && !hasAnyNum) {
      rows.push({
        row_no: 0, aoa_row_idx: i, sr, description: desc, unit, qty: null,
        material: null, installation: null, ml: null, rate: 0, amount: 0,
        remarks, kind: 'heading', errors: [], warnings: [],
      })
      continue
    }

    // Item row — validate + recompute via the shared evaluator.
    const ev = evaluateItem({ description: desc, unit, qty, material, installation, ml })
    seq += 1
    rows.push({
      row_no: seq, aoa_row_idx: i, sr, description: desc, unit, qty,
      material, installation, ml, rate: ev.rate, amount: ev.amount, remarks,
      kind: 'item', errors: ev.errors, warnings: ev.warnings,
    })
  }

  const itemRows = rows.filter(r => r.kind === 'item')
  const { subtotal, contingency, gst, grandTotal } =
    computeLadder(itemRows.map(r => r.amount), contingencyPct, gstPct)

  const ladder: TemplateLadder = {
    subtotal, contingencyPct, contingency, gstPct, gst, grandTotal, statedGrandTotal,
  }

  // Reconcile the recomputed grand total against the sheet's own stated cell.
  let reconciled = true
  let reconcileDiff = 0
  if (statedGrandTotal != null) {
    reconcileDiff = grandTotal - statedGrandTotal
    const tol = Math.max(1, Math.abs(statedGrandTotal) * RECONCILE_TOLERANCE)
    reconciled = Math.abs(reconcileDiff) <= tol
  }

  if (itemRows.length === 0) errors.push('No item rows found — the template is empty')
  if (!sawLadder) errors.push('No totals row found — keep the Subtotal / Grand Total rows')

  const errorCount = errors.length + rows.reduce((s, r) => s + r.errors.length, 0)

  return {
    isTemplate: true, meta, headerRowIdx, rows, itemRows, ladder,
    reconciled, reconcileDiff, errorCount, errors,
  }
}

/** Reconcile a recomputed grand total against the amount the engineer typed
 *  for approval. Used by the submit gate. */
export function reconcileAgainstClaim(grandTotal: number, claimed: number | null): {
  ok: boolean; diff: number; pct: number
} {
  if (claimed == null || claimed === 0) return { ok: false, diff: grandTotal, pct: 1 }
  const diff = grandTotal - claimed
  const pct = Math.abs(diff) / Math.abs(claimed)
  return { ok: pct <= RECONCILE_TOLERANCE, diff, pct }
}
