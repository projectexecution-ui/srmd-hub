// The ONE standard BOQ template every discipline downloads to raise a budget.
// Pure model builder (no xlsx import, so vitest covers the exact shape) + a
// thin xlsx writer lives in boq-template-xlsx.ts — same split as the
// excel-parse / excel-parse-adapter pair.
//
// Why a fixed template (design decisions, locked with Aksha):
//   • Fixed column ORDER → the template-mode parser (S2) reads by position,
//     never by fuzzy header matching (the source of most parse failures).
//   • Three rate cells — Material | Installation | M+L(combined). Engineers
//     fill EITHER Material+Installation OR the combined M+L, never both.
//     Rate = SUM(those three) so a blank cell counts as 0 (never #VALUE!),
//     and split-vs-composite both work without a second layout.
//   • Rate & Amount are FORMULAS (auto-calc). We never trust them on the way
//     back in — the parser recomputes — so tampering can't corrupt a figure.
//   • A very-hidden `_meta` sheet carries a marker + the project/discipline/
//     sub-skill ids so the parser can trust the file and pre-fill context.

export const BOQ_TEMPLATE_MARKER = 'CTHUB-BOQ-TPL'
export const BOQ_TEMPLATE_VERSION = 1
export const BOQ_META_SHEET = '_meta'
export const BOQ_SHEET = 'BOQ'
export const BOQ_MEASURE_SHEET = 'Measurement'

/** Measurement (take-off) tab column indices. Each BOQ Qty cell is a live
 *  formula into this tab's Qty column, so a quantity traces back to the exact
 *  cell it was measured in. */
export const MCOL = {
  sr: 0, description: 1, nos: 2, length: 3, breadth: 4, height: 5,
  qty: 6, unit: 7, remarks: 8,
} as const
export const MEASURE_COLS = [
  'Sr', 'Description', 'Nos', 'Length', 'Breadth', 'Height / Depth', 'Qty', 'Unit', 'Remarks',
] as const

/** Fixed column order. Index === column (A=0 … J=9). The parser depends on
 *  this exact order, so changing it is a template-version bump. */
export const BOQ_COLS = [
  'Sr', 'Description', 'Unit', 'Qty',
  'Material', 'Installation', 'M+L',
  'Rate', 'Amount', 'Remarks',
] as const
export type BoqColName = typeof BOQ_COLS[number]

/** 0-based column indices, named for readability in the writer + parser. */
export const COL = {
  sr: 0, description: 1, unit: 2, qty: 3,
  material: 4, installation: 5, ml: 6,
  rate: 7, amount: 8, remarks: 9,
} as const

/** Units accepted by the parser / offered to the engineer. LS = lump sum
 *  (Qty 1), % for contingency-style rows. Covers every shape seen in the
 *  ~1,600 real SRMD rows (split rates, lump sum, GST, negatives, headings). */
export const BOQ_UNITS = [
  'Cum', 'Sqm', 'Sft', 'Rmt', 'Rft', 'MT', 'Kg', 'Quintal',
  'Nos', 'Set', 'Pair', 'Ltr', 'Bag', 'Roll', 'Day', 'Month',
  'LS', 'Lot', '%',
] as const

const COL_WIDTHS = [5, 34, 8, 10, 12, 12, 11, 11, 14, 26]

export interface BoqTemplateOptions {
  projectCode?: string
  projectName?: string
  disciplineCode?: string
  disciplineName?: string
  subSkillCode?: string
  subSkillName?: string
  raisedBy?: string
  /** Caller supplies the date string (client `new Date()`), keeping the
   *  builder pure/deterministic for tests. */
  dateText?: string
  drawingRef?: string
  lineTypeLabel?: string
  /** Ids embedded in the hidden _meta sheet so the parser trusts context. */
  projectId?: string
  disciplineId?: string
  subSkillId?: string
  /** Blank item rows to lay out (default 25). */
  blankRows?: number
  /** Include the Measurement (take-off) tab and link every BOQ Qty cell to it
   *  (default true). The linkage is what lets the app trace a quantity back to
   *  the exact cell it was measured in. */
  withMeasurement?: boolean
}

export interface BoqCell {
  t: 's' | 'n'
  v?: string | number
  f?: string   // formula body, no leading '='
  z?: string   // number format
}
export interface BoqMerge { s: { r: number; c: number }; e: { r: number; c: number } }
export interface BoqSheetModel {
  name: string
  /** address ("A5") → cell. */
  cells: Record<string, BoqCell>
  merges: BoqMerge[]
  cols: Array<{ wch?: number; hidden?: boolean }>
  /** '' visible · 'hidden' · 'veryHidden'. */
  visibility: '' | 'hidden' | 'veryHidden'
  lastRow: number
  lastCol: number
}
export interface BoqTemplateModel {
  sheets: BoqSheetModel[]
  headerRow: number
  itemRowStart: number
  itemRowEnd: number
  subtotalRow: number
  contingencyRow: number
  gstRow: number
  grandTotalRow: number
}

const MONEY_FMT = '#,##0'
const colLetter = (c: number) => String.fromCharCode(65 + c)
const addr = (c: number, r1: number) => `${colLetter(c)}${r1}`

function s(v: string): BoqCell { return { t: 's', v } }
function n(v: number, z?: string): BoqCell { return z ? { t: 'n', v, z } : { t: 'n', v } }
function f(formula: string, z?: string): BoqCell {
  // A formula cell still needs a cached value (0) so a viewer that doesn't
  // recalc shows something sane; Excel recomputes on open.
  return z ? { t: 'n', v: 0, f: formula, z } : { t: 'n', v: 0, f: formula }
}

/** Pure builder — returns the full cell model of the standard template. */
export function buildBoqTemplateModel(opts: BoqTemplateOptions = {}): BoqTemplateModel {
  const blankRows = Math.max(5, opts.blankRows ?? 25)
  const withMeasurement = opts.withMeasurement !== false
  const cells: Record<string, BoqCell> = {}
  const merges: BoqMerge[] = []

  const disc = [opts.disciplineCode, opts.disciplineName].filter(Boolean).join(' ')
  const sub = [opts.subSkillCode, opts.subSkillName].filter(Boolean).join(' ')
  const proj = [opts.projectCode, opts.projectName].filter(Boolean).join(' ')

  // Row 1 — title (merged A:J)
  cells['A1'] = s(`STANDARD BOQ${disc ? ' — ' + disc : ''}${sub ? ' · ' + sub : ''}`)
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } })

  // Row 2 — context line (merged)
  const ctx = [
    proj && `Project: ${proj}`,
    opts.raisedBy && `Raised by: ${opts.raisedBy}`,
    opts.dateText && `Date: ${opts.dateText}`,
    opts.drawingRef && `Drawing: ${opts.drawingRef}`,
    opts.lineTypeLabel && `Type: ${opts.lineTypeLabel}`,
  ].filter(Boolean).join('  ·  ')
  cells['A2'] = s(ctx || 'Fill the header on the site before uploading.')
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 9 } })

  // Row 3 — the rule note (merged). Explains the M+L guard AND the three ways
  // to fill Qty (the take-off basis the app captures).
  cells['A3'] = s(
    'Fill EITHER Material + Installation OR the combined M+L — never both. ' +
    'Rate = Material + Installation + M+L (auto). Amount = Qty × Rate (auto). ' +
    'QTY — fill it ONE of three ways: (1) a plain number = ESTIMATE (no drawing); ' +
    '(2) a take-off formula e.g. =946+104.5 = MEASURED; ' +
    (withMeasurement ? '(3) =Measurement!G7 to pull from the optional Measurement tab = MEASURED. ' : '') +
    'Leave the grey Rate & Amount columns alone. For lump sum use Unit "LS", Qty 1. ' +
    'For a deduction, enter a negative Qty. Units: ' + BOQ_UNITS.join(' / ') + '.',
  )
  merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 9 } })

  // Row 5 — header
  const headerRow = 5
  BOQ_COLS.forEach((name, c) => { cells[addr(c, headerRow)] = s(name) })

  // Rows 6.. — blank item rows. Qty is left EMPTY (the engineer fills it a
  // plain number / inline formula / =Measurement!G link); Rate & Amount are
  // seeded formulas. A blank Qty gives Amount 0 (empty*0), never #VALUE!.
  const itemRowStart = headerRow + 1
  const itemRowEnd = itemRowStart + blankRows - 1
  for (let r = itemRowStart; r <= itemRowEnd; r++) {
    cells[addr(COL.sr, r)] = n(r - itemRowStart + 1)
    // Rate = SUM(Material:M+L) — blank cells count as 0, never #VALUE!.
    cells[addr(COL.rate, r)] = f(`SUM(${addr(COL.material, r)}:${addr(COL.ml, r)})`, MONEY_FMT)
    // Amount = Qty × Rate.
    cells[addr(COL.amount, r)] = f(`${addr(COL.qty, r)}*${addr(COL.rate, r)}`, MONEY_FMT)
  }

  // Totals ladder.
  const subtotalRow = itemRowEnd + 1
  const contingencyRow = subtotalRow + 1
  const gstRow = contingencyRow + 1
  const grandTotalRow = gstRow + 1
  const amtCol = colLetter(COL.amount)
  const rateCol = colLetter(COL.rate) // used to hold the % on ladder rows

  cells[addr(COL.ml, subtotalRow)] = s('Subtotal')
  cells[addr(COL.amount, subtotalRow)] =
    f(`SUM(${amtCol}${itemRowStart}:${amtCol}${itemRowEnd})`, MONEY_FMT)

  // Contingency + GST rows: the % sits in the Rate column (editable), the
  // Amount is a formula off it. Pre-filled with SRMD's usual 5% / 18% — the
  // engineer can change or clear the % (empty ⇒ 0, no error).
  cells[addr(COL.description, contingencyRow)] = s('Contingency')
  cells[addr(COL.rate, contingencyRow)] = n(5)
  cells[addr(COL.amount, contingencyRow)] =
    f(`ROUND(${amtCol}${subtotalRow}*${rateCol}${contingencyRow}/100,0)`, MONEY_FMT)

  cells[addr(COL.description, gstRow)] = s('GST')
  cells[addr(COL.rate, gstRow)] = n(18)
  cells[addr(COL.amount, gstRow)] =
    f(`ROUND((${amtCol}${subtotalRow}+${amtCol}${contingencyRow})*${rateCol}${gstRow}/100,0)`, MONEY_FMT)

  cells[addr(COL.ml, grandTotalRow)] = s('GRAND TOTAL')
  cells[addr(COL.amount, grandTotalRow)] =
    f(`${amtCol}${subtotalRow}+${amtCol}${contingencyRow}+${amtCol}${gstRow}`, MONEY_FMT)

  const boqSheet: BoqSheetModel = {
    name: BOQ_SHEET,
    cells,
    merges,
    cols: COL_WIDTHS.map(wch => ({ wch })),
    visibility: '',
    lastRow: grandTotalRow,
    lastCol: 9,
  }

  const meta = buildMetaSheet(opts)
  const sheets: BoqSheetModel[] = [boqSheet]
  if (withMeasurement) sheets.push(buildMeasurementSheet(headerRow, itemRowStart, itemRowEnd))
  sheets.push(meta)

  return {
    sheets,
    headerRow,
    itemRowStart,
    itemRowEnd,
    subtotalRow,
    contingencyRow,
    gstRow,
    grandTotalRow,
  }
}

/** The take-off tab. Each row auto-computes Qty = Nos × Length × Breadth ×
 *  Height (blank dimensions treated as 1; a blank Nos yields "" so the linked
 *  BOQ row stays empty). The engineer can overwrite any Qty cell with their own
 *  value/formula for takeoffs that don't fit N×L×B×H. Header + item rows share
 *  the BOQ's row numbers so BOQ!D{r} ↔ Measurement!G{r} line up 1:1. */
export function buildMeasurementSheet(
  headerRow: number, itemRowStart: number, itemRowEnd: number,
): BoqSheetModel {
  const cells: Record<string, BoqCell> = {}
  const merges: BoqMerge[] = []
  const mc = (c: number) => String.fromCharCode(65 + c)
  const at = (c: number, r1: number) => `${mc(c)}${r1}`

  cells['A1'] = s('MEASUREMENT / TAKE-OFF (optional helper) — structure your quantities here')
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 8 } })
  cells['A2'] = s(
    'OPTIONAL. Use this only if you want a structured take-off. Qty auto-computes = Nos × Length × Breadth × Height ' +
    '(leave a dimension blank to skip it — count only, or area). Then link it from the BOQ with =Measurement!G6 ' +
    'so an approver can click that quantity and land on this cell. Otherwise just put your formula or number ' +
    'straight in the BOQ Qty cell — you don’t have to use this tab.',
  )
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 8 } })

  MEASURE_COLS.forEach((name, c) => { cells[at(c, headerRow)] = s(name) })

  for (let r = itemRowStart; r <= itemRowEnd; r++) {
    cells[at(MCOL.sr, r)] = n(r - itemRowStart + 1)
    // Qty = Nos × (L|1) × (B|1) × (H|1); blank Nos ⇒ "" so the BOQ row stays empty.
    cells[at(MCOL.qty, r)] = f(
      `IF(${at(MCOL.nos, r)}="","",` +
      `${at(MCOL.nos, r)}*IF(${at(MCOL.length, r)}="",1,${at(MCOL.length, r)})` +
      `*IF(${at(MCOL.breadth, r)}="",1,${at(MCOL.breadth, r)})` +
      `*IF(${at(MCOL.height, r)}="",1,${at(MCOL.height, r)}))`,
    )
  }

  return {
    name: BOQ_MEASURE_SHEET,
    cells,
    merges,
    cols: [{ wch: 5 }, { wch: 34 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 11 }, { wch: 8 }, { wch: 26 }],
    visibility: '',
    lastRow: itemRowEnd,
    lastCol: 8,
  }
}

/** The very-hidden trust sheet the parser reads to identify a template file
 *  and pre-fill the project/discipline/sub-skill without any guessing. */
export function buildMetaSheet(opts: BoqTemplateOptions): BoqSheetModel {
  const kv: Array<[string, string]> = [
    ['marker', BOQ_TEMPLATE_MARKER],
    ['template_version', String(BOQ_TEMPLATE_VERSION)],
    ['project_id', opts.projectId ?? ''],
    ['discipline_id', opts.disciplineId ?? ''],
    ['sub_skill_id', opts.subSkillId ?? ''],
    ['project_code', opts.projectCode ?? ''],
    ['discipline_code', opts.disciplineCode ?? ''],
    ['sub_skill_code', opts.subSkillCode ?? ''],
    ['generated', opts.dateText ?? ''],
  ]
  const cells: Record<string, BoqCell> = {}
  kv.forEach(([k, v], i) => {
    cells[`A${i + 1}`] = s(k)
    cells[`B${i + 1}`] = s(v)
  })
  return {
    name: BOQ_META_SHEET,
    cells,
    merges: [],
    cols: [{ wch: 18 }, { wch: 40 }],
    visibility: 'veryHidden',
    lastRow: kv.length,
    lastCol: 1,
  }
}

/** Read a _meta key/value map back out of a parsed sheet's AoA. Used by the
 *  template-mode parser (S2) to detect + trust a template upload. */
export function readMetaFromAoa(aoa: unknown[][]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const row of aoa ?? []) {
    const k = row?.[0] == null ? '' : String(row[0]).trim()
    const v = row?.[1] == null ? '' : String(row[1]).trim()
    if (k) out[k] = v
  }
  return out
}

/** True when a workbook's sheet set + _meta marks it as our standard template. */
export function isBoqTemplateMeta(meta: Record<string, string>): boolean {
  return meta.marker === BOQ_TEMPLATE_MARKER
}

/** Default download filename for a template. */
export function boqTemplateFilename(opts: BoqTemplateOptions): string {
  const parts = [
    'BOQ',
    opts.disciplineCode || opts.disciplineName,
    opts.subSkillCode || opts.subSkillName,
  ].filter(Boolean).map(p => String(p).replace(/[^\w.-]+/g, '-'))
  return `${parts.join('_')}_template.xlsx`
}
