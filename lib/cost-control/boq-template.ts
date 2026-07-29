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
 *  this exact order, so changing it is a template-version bump.
 *  M+L (combined) is the STANDARD/default rate cell and comes first; Material +
 *  Installation are the OPTIONAL split, only used when rates come separately. */
export const BOQ_COLS = [
  'Sr', 'Description', 'Unit', 'Qty',
  'Rate (M+L)', 'Material (split)', 'Installation (split)',
  'Rate', 'Amount', 'Remarks',
] as const
export type BoqColName = typeof BOQ_COLS[number]

/** 0-based column indices, named for readability in the writer + parser.
 *  ml (the combined rate) is the default, placed right after Qty. */
export const COL = {
  sr: 0, description: 1, unit: 2, qty: 3,
  ml: 4, material: 5, installation: 6,
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

/** Matches a Qty take-off that pulls from the Measurement tab (=Measurement!G6,
 *  ='Measurement'!G6). Such a link must be re-pointed + its value re-seeded when
 *  a next version is pre-filled, or the quantity comes through blank. */
const MEASURE_REF = /measurement'?\s*!/i

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
  /** When raising the NEXT version of a sub-skill, pre-fill the BOQ with the
   *  previous version's rows so the engineer edits only what changed — and the
   *  descriptions stay identical, so the v-to-v cumulative match is clean. */
  seedRows?: BoqSeedRow[]
  /** The version number this template will become (previous + 1), stamped in
   *  the title so the engineer knows it's a revision, not a fresh sheet. */
  versionNo?: number
}

/** A prior-version row used to pre-fill the next-version template. */
export interface BoqSeedRow {
  description: string
  unit?: string | null
  qty?: number | null
  /** The prior Qty take-off formula (e.g. "946+104.5" or "Measurement!G6"),
   *  restored into the Qty cell so the row stays MEASURED, not re-estimated. */
  qtyFormula?: string | null
  material?: number | null
  installation?: number | null
  ml?: number | null
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
  const seed = opts.seedRows ?? []
  // Enough rows for the seeded prior version + spare lines to add new items
  // (the seed floor only applies when we're actually pre-filling).
  const blankRows = Math.max(5, opts.blankRows ?? 25, seed.length > 0 ? seed.length + 8 : 0)
  const withMeasurement = opts.withMeasurement !== false
  const cells: Record<string, BoqCell> = {}
  const merges: BoqMerge[] = []

  const disc = [opts.disciplineCode, opts.disciplineName].filter(Boolean).join(' ')
  const sub = [opts.subSkillCode, opts.subSkillName].filter(Boolean).join(' ')
  const proj = [opts.projectCode, opts.projectName].filter(Boolean).join(' ')

  // Row 1 — title (merged A:J)
  cells['A1'] = s(`STANDARD BOQ${disc ? ' — ' + disc : ''}${sub ? ' · ' + sub : ''}${opts.versionNo ? ` · Version ${opts.versionNo}` : ''}`)
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } })

  // Row 2 — context line (merged)
  const ctx = [
    proj && `Project: ${proj}`,
    opts.raisedBy && `Raised by: ${opts.raisedBy}`,
    opts.dateText && `Date: ${opts.dateText}`,
    opts.drawingRef && `Drawing: ${opts.drawingRef}`,
    opts.lineTypeLabel && `Type: ${opts.lineTypeLabel}`,
    seed.length > 0 && `Pre-filled from the previous version — edit only what changed, add new rows below`,
  ].filter(Boolean).join('  ·  ')
  cells['A2'] = s(ctx || 'Fill the header on the site before uploading.')
  merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: 9 } })

  // Row 3 — the rule note (merged). M+L is the standard; split is the exception.
  cells['A3'] = s(
    'RATE — normally just fill the combined "Rate (M+L)". Only if the rate comes ' +
    'split do you use Material + Installation instead (then leave M+L blank) — never both. ' +
    'Rate & Amount auto-calc. ' +
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
    const i = r - itemRowStart
    cells[addr(COL.sr, r)] = n(i + 1)
    // Pre-fill from the previous version's row when seeding a next-version
    // template — description/unit/qty + whichever rate side was used.
    const sd = seed[i]
    if (sd) {
      cells[addr(COL.description, r)] = s(sd.description ?? '')
      if (sd.unit) cells[addr(COL.unit, r)] = s(sd.unit)
      // Qty carry-forward (stays MEASURED wherever it was):
      //  • a Measurement-tab link (=Measurement!G6) → re-point it at THIS row and
      //    seed the carried value into the Measurement tab below, so it never
      //    dangles (fixes "v2 clears the Measurement data").
      //  • a self-contained inline take-off formula (=946+104.5) → restore as-is.
      //  • otherwise the plain number.
      const qf = (sd.qtyFormula ?? '').trim().replace(/^=/, '')
      if (qf && withMeasurement && MEASURE_REF.test(qf)) {
        cells[addr(COL.qty, r)] = f(`${BOQ_MEASURE_SHEET}!${colLetter(MCOL.qty)}${r}`)
      } else if (qf && !MEASURE_REF.test(qf)) {
        cells[addr(COL.qty, r)] = f(qf)
      } else if (sd.qty != null) {
        cells[addr(COL.qty, r)] = n(sd.qty)
      }
      // Rate: keep the split if the prior row was split, else the combined M+L.
      if (sd.material != null || sd.installation != null) {
        if (sd.material != null) cells[addr(COL.material, r)] = n(sd.material, MONEY_FMT)
        if (sd.installation != null) cells[addr(COL.installation, r)] = n(sd.installation, MONEY_FMT)
      } else if (sd.ml != null) {
        cells[addr(COL.ml, r)] = n(sd.ml, MONEY_FMT)
      }
    }
    // Rate = SUM(M+L, Material, Installation) — the three rate cells (E:G),
    // whichever side is filled. Blank cells count as 0, never #VALUE!.
    cells[addr(COL.rate, r)] = f(`SUM(${addr(COL.ml, r)}:${addr(COL.installation, r)})`, MONEY_FMT)
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
  if (withMeasurement) sheets.push(buildMeasurementSheet(headerRow, itemRowStart, itemRowEnd, seed))
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
  seed: BoqSeedRow[] = [],
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
    const sd = seed[r - itemRowStart]
    if (sd && MEASURE_REF.test(sd.qtyFormula ?? '')) {
      // Carry-forward: the prior version pulled this quantity from the
      // Measurement tab, so restore its measured value (+ description) here so
      // the BOQ's =Measurement!G{r} link resolves instead of coming through
      // blank. The dimension breakdown (Nos/L/B/H) isn't stored per version —
      // those stay empty and can be re-measured; the total carries through.
      if (sd.description) cells[at(MCOL.description, r)] = s(sd.description)
      if (sd.qty != null) cells[at(MCOL.qty, r)] = n(sd.qty)
    } else {
      // Blank helper row: Qty = Nos × (L|1) × (B|1) × (H|1); blank Nos ⇒ "" so
      // the linked BOQ row stays empty.
      cells[at(MCOL.qty, r)] = f(
        `IF(${at(MCOL.nos, r)}="","",` +
        `${at(MCOL.nos, r)}*IF(${at(MCOL.length, r)}="",1,${at(MCOL.length, r)})` +
        `*IF(${at(MCOL.breadth, r)}="",1,${at(MCOL.breadth, r)})` +
        `*IF(${at(MCOL.height, r)}="",1,${at(MCOL.height, r)}))`,
      )
    }
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
// Download filename: carry enough to tell one downloaded template from another
// at a glance — project, discipline, sub-skill, version and date — because a
// user downloads many of these across projects/versions over time and generic
// names collide. Shape: BOQ_<project>_<discipline>_<sub-skill>_v<N>_<date>.xlsx
export function boqTemplateFilename(opts: BoqTemplateOptions): string {
  // Trim, turn anything filesystem-unfriendly (spaces, slashes, ·, —) into a
  // single dash, and drop leading/trailing dashes.
  const clean = (v?: string | number) =>
    v == null ? '' : String(v).trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '')

  const project    = opts.projectName || opts.projectCode
  const discipline = [opts.disciplineCode, opts.disciplineName].filter(Boolean).join(' ')
  const subSkill   = [opts.subSkillCode, opts.subSkillName].filter(Boolean).join(' ')

  const parts = [
    'BOQ',
    project,
    discipline,
    subSkill,
    `v${opts.versionNo ?? 1}`, // a fresh upload becomes v1; a re-raise stamps v(N+1)
    opts.dateText,             // e.g. "29 Jul 2026" → "29-Jul-2026"
  ].map(clean).filter(Boolean)

  return `${parts.join('_')}.xlsx`
}
