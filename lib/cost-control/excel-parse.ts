// Pure Excel-working analyzer for Cost Control Quick mode. Engineers upload
// wildly varied BOQ/estimate workbooks; this module finds the money sheet,
// the line items, and the REAL approval figure — with zero AI and zero DB.
//
// Design rules:
//   • AoA in, plain objects out. No xlsx import (the adapter file owns that),
//     so the vitest suite runs on literal array fixtures.
//   • Handles the shapes seen in real SRMD workings (fixtures replicate two
//     actual files): multi-sheet books, TWO-ROW headers, approval ladders
//     ("Sub Total → GST → Total → APPROVAL FOR TOTAL AMOUNT TO ENTER IN ERP
//     SYSTEM"), area-statement traps ("Total Slab Area" is NOT money),
//     payment-terms tails, group parent rows, zero-amount lump-sum items.
//   • detectColumns / toNum / breakdownLabel keep the exact semantics they
//     had inline in NewWSQuickForm (regression-pinned by SIMPLE_BOQ tests),
//     with ONE additive change: `activity|boq` in the description regex.

export type ColKind = 'description' | 'unit' | 'qty' | 'rate' | 'amount'
export interface DetectedCol {
  i: number
  kind: ColKind
  isTotal: boolean   // header says "total" / "grand" / "sum" / "combined"
  label: string      // original header text — used for breakdown labels
}
export interface Breakdown { label: string; value: number }

export type LadderRole = 'item' | 'tax' | 'addon' | 'discount'
export interface ParsedRow {
  row_no: number                 // 1-based output sequence
  aoa_row_idx: number            // absolute AoA index (NOT persisted)
  raw_label: string | null
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
  formula_in_amount: string | null
  rate_breakdown: Breakdown[] | null
  amount_breakdown: Breakdown[] | null
  ladder_role: LadderRole
}

export type TotalRank = 1 | 2 | 3
export interface TotalCandidate {
  aoaRowIdx: number
  description: string
  amount: number
  rank: TotalRank
  excluded: boolean
  excludeReason: string | null
}
export interface ApprovalFigure {
  amount: number
  rank: TotalRank
  sourceRowText: string
  aoaRowIdx: number
}

export interface CategoryHint {
  mainCategoryCode: string | null
  mainCategoryName: string | null
  subCategoryCode: string | null
  rawText: string
}

export interface HeaderDetection {
  headerRowIdx: number
  spansTwoRows: boolean
  cols: DetectedCol[]
  dataStartIdx: number
}

export interface SheetInput {
  name: string
  aoa: unknown[][]
  formulaOf?: (r: number, c: number) => string | null
}

export type TotalSource = 'approval' | 'grand_total' | 'total' | 'sum_of_rows' | 'none'

export interface SheetAnalysis {
  name: string
  headerRowIdx: number | null
  headerSpansTwoRows: boolean
  columns: DetectedCol[]
  rows: ParsedRow[]              // post-ladder-cut
  totalCandidates: TotalCandidate[]
  approvalFigure: ApprovalFigure | null
  grandTotal: number | null
  totalSource: TotalSource
  categoryHint: CategoryHint | null
  contextBlock: string[]
  itemCount: number              // ladder_role='item' AND amount != null
  score: number
}
export interface WorkbookAnalysis { sheets: SheetAnalysis[]; bestSheetIndex: number }

// ─── Regex vocabulary (exported for tests) ────────────────────────────────

/** Rank 3 — the explicit "this is the approval number" phrases. */
export const RANK3_RE = /approval.*(amount|total)|to\s*enter\s*in\s*erp|total\s*estimated\s*cost(ing)?|total\s*amount\s*with\s*tax|final\s*(pay|amount|total)/i
/** Rank 2 — a proper grand total. */
export const RANK2_RE = /grand\s*total/i
/** Rank 1 — any total-ish row. */
export const RANK1_RE = /\b(total|sub[\s-]*total|sum)\b/i
/** Unit-metric trap — "Total Slab Area", "Total Quantity … SMT", "Cost per
 *  Sqft", area rows. These are measurements, never money. */
export const UNIT_METRIC_RE = /\b(area|slab|sq\.?\s*m\b|sqm|smt|sft|sq\.?\s*ft|sqft|rmt|cum|nos\.?|quantity)\b|per\s+(sq|sft|sqft|sqm|unit)/i
export const TAX_RE = /\bgst\b|cgst|sgst|igst|utgst|cess|\bvat\b|service\s*tax|\btds\b|\btcs\b|\btax\b/i
export const ADDON_RE = /freight|transport|packing|p\s*&\s*f|insurance|loading|handling|carting|misc|sundry|conting|\bra\s*-?\s*\d+\b|previous\s*wo|advance/i
export const DISCOUNT_RE = /discount|rebate|\bless\b/i
/** Sheet names that are supporting material, not the money sheet. */
export const SUPPORT_SHEET_RE = /terms?|condition|area|detail|count|statement|note/i

// ─── Small helpers (moved verbatim from NewWSQuickForm) ───────────────────

export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,₹\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function breakdownLabel(raw: string): string {
  return raw
    .replace(/\b(rate|amount|value|cost|amt|total|grand|sum|combined|all[\s-]*in|net|per\s*unit|p\/u)\b/gi, '')
    .replace(/[()\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || raw.trim()
}

export function detectColumns(headerRow: unknown[]): DetectedCol[] {
  const out: DetectedCol[] = []
  headerRow.forEach((h, i) => {
    const raw = String(h ?? '').trim()
    if (!raw) return
    const s = raw.toLowerCase()
    let kind: ColKind | null = null
    // `activity|boq` are additive — real MEP sheets label the description
    // column "ACTIVITY" (see the plumbing fixture).
    if (/(description|item|particular|work|head|nature|scope|activity|boq|sr\.?\s*description)/.test(s)) kind = 'description'
    else if (/^unit$|^uom$|\bof\s+meas/.test(s)) kind = 'unit'
    else if (/^qty\b|^quantity\b|\bnos\b|\bcount\b|estimated\s*quantity/.test(s)) kind = 'qty'
    else if (/(amount|value|cost(?!\s*per)|amt|line\s*total)/.test(s)) kind = 'amount'
    else if (/(rate|price|unit\s*rate|cost\s*per|p\/u|per\s*unit)/.test(s)) kind = 'rate'
    if (!kind) return
    const isTotal = /\b(total|grand|sum|combined|all[\s-]*in|net)\b/.test(s)
    out.push({ i, kind, isTotal, label: raw })
  })
  return out
}

function headerCondition(detected: DetectedCol[]): boolean {
  const kinds = new Set(detected.map(c => c.kind))
  const hasMoney = kinds.has('rate') || kinds.has('amount')
  const hasShape = kinds.has('qty') || kinds.has('unit')
  return kinds.has('description') && hasMoney && hasShape
}

function isRowEmpty(r: unknown[] | undefined | null): boolean {
  return !r || r.every(c => c == null || String(c).trim() === '')
}

// ─── Header detection (single-row + two-row merge) ────────────────────────

export function detectHeader(aoa: unknown[][]): HeaderDetection | null {
  const scanMax = Math.min(aoa.length, 25)

  // Pass 1 — today's single-row logic, unchanged.
  for (let i = 0; i < scanMax; i++) {
    const detected = detectColumns(aoa[i] ?? [])
    if (headerCondition(detected)) {
      return { headerRowIdx: i, spansTwoRows: false, cols: detected, dataStartIdx: i + 1 }
    }
  }

  // Pass 2 — TWO-ROW headers: labels split across two adjacent rows.
  // Seen in the wild both ways:
  //   R1: SR.NO | ACTIVITY | UNIT | QTY;   R2: "ITC" RATE | TOTAL AMOUNT
  //   R1: Sr. No. | Description;           R2: Unit | Quantity | Rate | Amount
  // Row 1 must carry the description (and NO money); row 2 the money (and
  // NO description); qty/unit may sit on either row — the merged header
  // must pass the full description+money+shape condition.
  for (let i = 0; i < scanMax; i++) {
    const row1 = aoa[i] ?? []
    const d1 = detectColumns(row1)
    const k1 = new Set(d1.map(c => c.kind))
    const descNoMoney = k1.has('description') && !k1.has('rate') && !k1.has('amount')
    if (!descNoMoney) continue
    // next non-empty row (allow one blank in between)
    let j = i + 1
    while (j < Math.min(aoa.length, i + 3) && isRowEmpty(aoa[j])) j++
    if (j >= aoa.length) continue
    const row2 = aoa[j] ?? []
    const d2 = detectColumns(row2)
    const k2 = new Set(d2.map(c => c.kind))
    const moneyOnly = (k2.has('rate') || k2.has('amount')) && !k2.has('description')
    if (!moneyOnly) continue
    // Merge labels column-wise and re-detect.
    const width = Math.max(row1.length, row2.length)
    const merged: unknown[] = []
    for (let c = 0; c < width; c++) {
      const a = String(row1[c] ?? '').trim()
      const b = String(row2[c] ?? '').trim()
      merged.push([a, b].filter(Boolean).join(' ') || null)
    }
    const dm = detectColumns(merged)
    if (headerCondition(dm)) {
      return { headerRowIdx: i, spansTwoRows: true, cols: dm, dataStartIdx: j + 1 }
    }
  }

  return null
}

// ─── Ladder classification ─────────────────────────────────────────────────

export function rankTotalRow(desc: string): TotalRank | null {
  if (RANK3_RE.test(desc)) return 3
  if (RANK2_RE.test(desc)) return 2
  if (RANK1_RE.test(desc)) return 1
  return null
}

export function isUnitMetricRow(desc: string, unit?: string | null): boolean {
  if (UNIT_METRIC_RE.test(desc)) return true
  if (unit && /^(sqm|sft|sqft|sq\.?\s*ft|sq\.?\s*m|rmt|cum)$/i.test(unit.trim())) return true
  return false
}

export function ladderRoleFor(desc: string): LadderRole {
  if (TAX_RE.test(desc)) return 'tax'
  if (DISCOUNT_RE.test(desc)) return 'discount'
  if (ADDON_RE.test(desc)) return 'addon'
  return 'item'
}

// ─── Row extraction ────────────────────────────────────────────────────────

export function extractRows(
  aoa: unknown[][],
  header: HeaderDetection,
  formulaOf?: (r: number, c: number) => string | null,
): { rows: ParsedRow[]; totalCandidates: TotalCandidate[] } {
  const cols = header.cols
  // Several columns can look description-ish ("WORK CATEGORY", "Item",
  // "DESCRIPTION"). Prefer the one literally labelled Description, then
  // fall back to the first match (today's behaviour).
  const descCols = cols.filter(c => c.kind === 'description')
  const descCol  = descCols.find(c => /^(sr\.?\s*)?description$/i.test(c.label.trim())) ?? descCols[0]
  const unitCol  = cols.find(c => c.kind === 'unit')
  const qtyCol   = cols.find(c => c.kind === 'qty')
  const rateCols   = cols.filter(c => c.kind === 'rate')
  const amountCols = cols.filter(c => c.kind === 'amount')

  function pickTotalAndParts(group: DetectedCol[]): { total: DetectedCol | null; parts: DetectedCol[] } {
    if (group.length === 0) return { total: null, parts: [] }
    if (group.length === 1) return { total: group[0], parts: [] }
    const total = group.find(c => c.isTotal) ?? null
    const parts = total ? group.filter(c => c.i !== total.i) : group
    return { total, parts }
  }
  const ratePick   = pickTotalAndParts(rateCols)
  const amountPick = pickTotalAndParts(amountCols)

  const rows: ParsedRow[] = []
  const totalCandidates: TotalCandidate[] = []

  for (let i = header.dataStartIdx; i < aoa.length; i++) {
    const r = aoa[i]
    if (isRowEmpty(r)) continue
    const label = r[0] != null ? String(r[0]) : null
    const desc  = descCol ? (r[descCol.i] != null ? String(r[descCol.i]) : label) : label
    const unit  = unitCol ? (r[unitCol.i] != null ? String(r[unitCol.i]) : null) : null
    const qty   = qtyCol ? toNum(r[qtyCol.i]) : null

    let rate: number | null = null
    const rateBreakdown: Breakdown[] = []
    if (ratePick.total) {
      const v = toNum(r[ratePick.total.i])
      if (v != null) rate = v
    }
    for (const c of ratePick.parts) {
      const v = toNum(r[c.i])
      if (v != null) rateBreakdown.push({ label: breakdownLabel(c.label) || 'part', value: v })
    }
    if (rate == null && rateBreakdown.length > 0) rate = rateBreakdown.reduce((s, b) => s + b.value, 0)

    let amount: number | null = null
    const amountBreakdown: Breakdown[] = []
    if (amountPick.total) {
      const v = toNum(r[amountPick.total.i])
      if (v != null) amount = v
    }
    for (const c of amountPick.parts) {
      const v = toNum(r[c.i])
      if (v != null) amountBreakdown.push({ label: breakdownLabel(c.label) || 'part', value: v })
    }
    if (amount == null && amountBreakdown.length > 0) amount = amountBreakdown.reduce((s, b) => s + b.value, 0)

    // Total candidate? Same core condition as before (total-ish description,
    // amount present, qty or rate missing) — now ranked + trap-checked.
    const rank = desc ? rankTotalRow(desc) : null
    if (rank != null && amount != null && (qty == null || rate == null)) {
      const excluded = isUnitMetricRow(desc!, unit)
      totalCandidates.push({
        aoaRowIdx: i,
        description: desc!.trim(),
        amount,
        rank,
        excluded,
        excludeReason: excluded ? 'unit/area metric — not money' : null,
      })
      continue
    }

    let formulaInAmount: string | null = null
    const formulaCol = amountPick.total ?? amountPick.parts[0]
    if (formulaCol && formulaOf) {
      formulaInAmount = formulaOf(i, formulaCol.i)
    }

    // Ladder roles (tax/addon/discount) are for SUMMARY rows only. A row
    // with both qty and rate is a measured BOQ line — always an item, even
    // when its long description mentions "GST"/"advance" etc. Rows without
    // an amount can't participate in ladder math either.
    const isMeasuredLine = qty != null && rate != null
    const ladderRole: LadderRole =
      desc && amount != null && !isMeasuredLine ? ladderRoleFor(desc) : 'item'

    rows.push({
      row_no: rows.length + 1,
      aoa_row_idx: i,
      raw_label: label,
      description: desc,
      unit,
      qty,
      rate,
      amount,
      formula_in_amount: formulaInAmount,
      rate_breakdown:   rateBreakdown.length   ? rateBreakdown   : null,
      amount_breakdown: amountBreakdown.length ? amountBreakdown : null,
      ladder_role: ladderRole,
    })
  }

  return { rows, totalCandidates }
}

// ─── Approval-figure pick + ladder cut ─────────────────────────────────────

export function pickApprovalFigure(candidates: TotalCandidate[]): ApprovalFigure | null {
  const eligible = candidates.filter(c => !c.excluded)
  if (eligible.length === 0) return null
  let best = eligible[0]
  for (const c of eligible.slice(1)) {
    // Higher rank wins; within a rank the LAST (bottom-most) wins — Indian
    // sheets put the real figure after GST/contingency.
    if (c.rank > best.rank || (c.rank === best.rank && c.aoaRowIdx > best.aoaRowIdx)) best = c
  }
  return { amount: best.amount, rank: best.rank, sourceRowText: best.description, aoaRowIdx: best.aoaRowIdx }
}

/** Drop everything below the winning total (payment terms, contacts, notes,
 *  Cost/SqFt). Inside the ladder zone (first candidate → winner), keep only
 *  tax/addon/discount rows — plain rows there are ladder arithmetic. */
export function applyLadderCut(
  rows: ParsedRow[],
  candidates: TotalCandidate[],
  winner: ApprovalFigure | null,
): ParsedRow[] {
  if (!winner) return rows
  const ladderStart = candidates.length > 0 ? Math.min(...candidates.map(c => c.aoaRowIdx)) : winner.aoaRowIdx
  const kept = rows.filter(r => {
    if (r.aoa_row_idx > winner.aoaRowIdx) return false            // below the winner → tail junk
    if (r.aoa_row_idx > ladderStart) {                            // inside the ladder zone
      return r.ladder_role !== 'item' && r.amount != null         // keep GST / RA adj / discount only
    }
    return true                                                   // normal items above the ladder
  })
  // Re-sequence row_no after the cut.
  return kept.map((r, idx) => ({ ...r, row_no: idx + 1 }))
}

// ─── Category hint + context block ─────────────────────────────────────────

export function extractCategoryHint(preHeaderRows: unknown[][]): CategoryHint | null {
  for (const row of preHeaderRows) {
    for (const cell of row ?? []) {
      if (cell == null) continue
      const s = String(cell)
      // Name class deliberately excludes '/' and ':' so "08 PLUMBING WORKS/
      // SUB CATEGORY : 805" captures just "PLUMBING WORKS".
      const main = s.match(/MAIN\s*CATEGORY\s*:?\s*(\d+)\s*([A-Za-z][A-Za-z &-]*)?/i)
      const sub  = s.match(/SUB\s*CATEGORY\s*:?\s*([\d.]+)/i)
      if (main || sub) {
        return {
          mainCategoryCode: main ? main[1] : null,
          mainCategoryName: main && main[2] ? main[2].trim().replace(/[-]+$/, '').trim() || null : null,
          subCategoryCode: sub ? sub[1].replace(/\.+$/, '') : null,
          rawText: s.trim(),
        }
      }
    }
  }
  return null
}

function buildContextBlock(preHeaderRows: unknown[][], max = 10): string[] {
  const out: string[] = []
  for (const row of preHeaderRows) {
    if (isRowEmpty(row)) continue
    const text = (row ?? [])
      .map(c => (c == null ? '' : String(c).trim()))
      .filter(Boolean)
      .join(' · ')
    if (text) out.push(text)
    if (out.length >= max) break
  }
  return out
}

// ─── Total-only sheets (no detectable header) ─────────────────────────────

export function scanTotalsWithoutHeader(aoa: unknown[][]): TotalCandidate[] {
  const out: TotalCandidate[] = []
  for (let i = 0; i < aoa.length; i++) {
    const r = aoa[i]
    if (isRowEmpty(r)) continue
    const texts = (r ?? []).filter(c => c != null && typeof c !== 'number' && String(c).trim() !== '').map(String)
    const nums = (r ?? []).map(toNum).filter((n): n is number => n != null)
    if (texts.length === 0 || nums.length !== 1) continue
    const desc = texts.join(' ')
    const rank = rankTotalRow(desc)
    if (rank == null) continue
    const excluded = isUnitMetricRow(desc)
    out.push({ aoaRowIdx: i, description: desc.trim(), amount: nums[0], rank, excluded, excludeReason: excluded ? 'unit/area metric — not money' : null })
  }
  return out
}

// ─── Per-sheet analysis + workbook scoring ─────────────────────────────────

const MAX_SHEET_ROWS = 2000

function magnitudeBucket(total: number | null): number {
  if (total == null || total <= 0) return 0
  return Math.min(Math.floor(Math.log10(total + 1)), 9)
}

export function analyzeSheet(input: SheetInput): SheetAnalysis {
  // Trim trailing fully-empty rows + defensive cap.
  let aoa = input.aoa ?? []
  let lastNonEmpty = -1
  for (let i = 0; i < Math.min(aoa.length, MAX_SHEET_ROWS); i++) {
    if (!isRowEmpty(aoa[i])) lastNonEmpty = i
  }
  aoa = aoa.slice(0, lastNonEmpty + 1)

  const header = detectHeader(aoa)

  let rows: ParsedRow[] = []
  let totalCandidates: TotalCandidate[] = []
  if (header) {
    const extracted = extractRows(aoa, header, input.formulaOf)
    rows = extracted.rows
    totalCandidates = extracted.totalCandidates
  } else {
    totalCandidates = scanTotalsWithoutHeader(aoa)
  }

  const approvalFigure = pickApprovalFigure(totalCandidates)
  if (header) rows = applyLadderCut(rows, totalCandidates, approvalFigure)

  // Grand total: winner, else reconciled sum of kept rows.
  let grandTotal: number | null = null
  let totalSource: TotalSource = 'none'
  if (approvalFigure) {
    grandTotal = approvalFigure.amount
    totalSource = approvalFigure.rank === 3 ? 'approval' : approvalFigure.rank === 2 ? 'grand_total' : 'total'
  } else {
    const sum = rows.reduce((s, r) => {
      const a = r.amount ?? 0
      if (r.ladder_role === 'discount') return s - Math.abs(a)
      return s + a
    }, 0)
    if (sum > 0) { grandTotal = sum; totalSource = 'sum_of_rows' }
  }

  const preHeaderRows = header ? aoa.slice(0, header.headerRowIdx) : aoa.slice(0, 10)
  const categoryHint = extractCategoryHint(preHeaderRows)
  const contextBlock = buildContextBlock(preHeaderRows)

  const itemCount = rows.filter(r => r.ladder_role === 'item' && r.amount != null).length

  let score = 0
  if (header) score += 40
  score += Math.min(itemCount, 20) * 2
  if (approvalFigure) score += approvalFigure.rank * 10
  score += magnitudeBucket(grandTotal)
  // A sheet with actual money on it beats a bigger rate-only sheet whose
  // amounts are all zero (comparison workbooks embed both).
  if (grandTotal != null && grandTotal > 0) score += 15
  if (SUPPORT_SHEET_RE.test(input.name)) score -= 15

  return {
    name: input.name,
    headerRowIdx: header?.headerRowIdx ?? null,
    headerSpansTwoRows: header?.spansTwoRows ?? false,
    columns: header?.cols ?? [],
    rows,
    totalCandidates,
    approvalFigure,
    grandTotal,
    totalSource,
    categoryHint,
    contextBlock,
    itemCount,
    score,
  }
}

export function analyzeWorkbook(inputs: SheetInput[]): WorkbookAnalysis {
  const sheets = inputs.map(analyzeSheet)
  let bestSheetIndex = 0
  for (let i = 1; i < sheets.length; i++) {
    if (sheets[i].score > sheets[bestSheetIndex].score) bestSheetIndex = i
  }
  return { sheets, bestSheetIndex }
}

// ─── AI payload slicing ────────────────────────────────────────────────────

/** The AoA region worth sending to the AI: everything up to (and incl.)
 *  the approval row + 2, capped. Payment-terms tails never reach the AI. */
export function sliceAoaForAi(analysis: SheetAnalysis, aoa: unknown[][], cap = 120): unknown[][] {
  const end = analysis.approvalFigure ? analysis.approvalFigure.aoaRowIdx + 3 : aoa.length
  return aoa.slice(0, Math.min(end, cap))
}
