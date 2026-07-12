// Parser for the STANDARD SRM Internal Budget format — the versioned files
// under "02 Internal Budgets" on the shared drive. Pure (AoA in via
// SheetInput, plain objects out); reuses the adapter from excel-parse.
//
// Format (verified on SRAH V9, NGH B V8, Vinay V4, CV5 V1, Welcome Centre V1):
//   • First sheet is the standard grid. Header row has "Work Category …" in
//     col A and "Sub Skill …" in col B; the NEXT row carries sub-labels
//     ("Itemwise Budget" / "Category Total" / "Rs/Sft").
//   • Discipline rows: col A = "NN Name" (2-digit code).
//   • Sub-skill rows:  col B = "NNN(N) Name" (3-4 digit code).
//   • MONEY COLUMNS SHIFT PER FILE. Candidate pairs (itemwise + category):
//       - "Internal Estimated Budget" pair  ← preferred (the internal number)
//       - the fixed Amt (F) / Cat Total (G) pair
//       - "Consultants Budget" / "CS" / "SC Budget" pair ← fallback
//     A pair only wins if its item sum is non-zero.
//   • Area (sft) sits in the title block ("Area (in sq. ft.)" label, or the
//     "Sft." row on older files).
//   • Footer "Total Amount with GST (A)" row = the grand total.
//   • Per-sub-skill WORKINGS often live on separate tabs named by code
//     ("310 Window Sill", "1204 1205 Flooring & dado") — harvested as
//     working lines for those sub-skills.

import type { SheetInput } from './excel-parse'
import { toNum } from './excel-parse'

export interface IBWorkingLine {
  row_no: number
  description: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
}

export interface IBSubSkill {
  /** Master sub-skill code, or null for uncoded prose rows (infra variant
   *  lines like "Substation/HT Building") — their money is still captured. */
  code: string | null
  name: string
  amount: number
  /** Working lines harvested from a matching code-named tab, if any. */
  working: IBWorkingLine[] | null
  workingSheetName: string | null
  /** Remark text from the grid (e.g. "Thumbrule - 20 Rs per sft"). */
  remark: string | null
}

export interface IBDiscipline {
  /** Master discipline code; null for prose sections ("Compound Wall") that
   *  never see a coded sub-skill to derive it from. */
  code: string | null
  name: string
  categoryTotal: number | null
  subSkills: IBSubSkill[]
  /** |Σ sub-skills − categoryTotal| when both known. */
  reconDelta: number | null
}

export type IBMoneySource = 'internal_estimated' | 'amt' | 'consultants'

export interface InternalBudget {
  sheetName: string
  areaSft: number | null
  grandTotal: number | null
  grandTotalSource: 'footer' | 'sum' | null
  moneySource: IBMoneySource | null
  disciplines: IBDiscipline[]
  /** Rows that looked like disciplines/sub-skills but had no parseable code. */
  skipped: Array<{ rowIdx: number; text: string; reason: string }>
  /** Σ of all sub-skill amounts. */
  itemSum: number
  parseOk: boolean
  failReason: string | null
}

const DISC_RE = /^\s*(\d{2})\s+\S/
// Sub-skill codes: 3-4 digits, optionally with a decimal variant suffix
// ("715.1 Lighting Arrester" rolls up under master code 715).
const SUB_RE  = /^\s*(\d{3,4})(?:\.\d+)?\s+\S/
// Name = text after the code. Separate strip patterns (without the trailing
// \S) so replace() doesn't eat the name's first letter.
const DISC_STRIP = /^\s*\d{2}\s+/
const SUB_STRIP  = /^\s*\d{3,4}(?:\.\d+)?\s+/

const cell = (r: unknown[] | undefined, i: number): unknown => (r ? r[i] : null)
const str = (v: unknown): string => (v == null ? '' : String(v).trim())

interface Pair { item: number; cat: number | null; source: IBMoneySource }

/** Locate candidate money pairs from the header + sub-label rows. */
function findMoneyPairs(header: unknown[], sub: unknown[]): Pair[] {
  const width = Math.max(header.length, sub.length)
  const pairs: Pair[] = []

  // Group headers span columns: a label at col i applies until the next
  // non-empty header label. Sub-labels name the columns inside the group.
  const groups: Array<{ label: string; start: number; end: number }> = []
  for (let i = 0; i < width; i++) {
    const h = str(header[i])
    if (!h) continue
    if (groups.length) groups[groups.length - 1].end = i - 1
    groups.push({ label: h, start: i, end: width - 1 })
  }

  for (const g of groups) {
    let source: IBMoneySource | null = null
    // "Internal Estimated Budget" (buildings) and "Internal Budget" (infra
    // variant) both mark the preferred pair.
    if (/internal\s*(estimat|budget)/i.test(g.label)) source = 'internal_estimated'
    else if (/consultant|\bcs\b|sc\s*budget/i.test(g.label)) source = 'consultants'
    if (!source) continue
    // Inside the group: itemwise col = sub-label "Itemwise Budget" (else the
    // group's own start col); category col = sub-label "Category Total".
    let item = -1
    let cat: number | null = null
    for (let i = g.start; i <= g.end; i++) {
      const s = str(sub[i])
      if (/itemwise/i.test(s) && item < 0) item = i
      if (/category\s*total/i.test(s)) cat = i
    }
    if (item < 0) item = g.start
    pairs.push({ item, cat, source })
  }

  // The fixed internal Amt (F) / Cat Total (G) pair from the standard labels.
  for (let i = 0; i < width; i++) {
    if (str(header[i]) === 'Amt') {
      let cat: number | null = null
      for (let j = i + 1; j < Math.min(i + 3, width); j++) {
        if (/cat\s*total/i.test(str(header[j]))) { cat = j; break }
      }
      pairs.push({ item: i, cat, source: 'amt' })
      break
    }
  }

  return pairs
}

/** Area from the title block: a cell matching "Area … sq/ Sft" with a number
 *  to its right, or the "Sft." row's small numeric. */
function findArea(aoa: unknown[][], headerIdx: number): number | null {
  for (let i = 0; i < headerIdx; i++) {
    const r = aoa[i] ?? []
    for (let c = 0; c < r.length; c++) {
      if (/area\s*\(?(in\s*)?sq/i.test(str(r[c]))) {
        for (let k = c + 1; k < r.length; k++) {
          const n = toNum(r[k])
          if (n != null && n > 20 && n < 10_000_000) return n
        }
      }
    }
  }
  // Older files: the "Sft." row carries area as the first plausible numeric.
  for (let i = 0; i < headerIdx; i++) {
    const r = aoa[i] ?? []
    if (r.some(v => str(v) === 'Sft.')) {
      for (let c = 0; c < r.length; c++) {
        const n = toNum(r[c])
        if (n != null && n > 100 && n < 1_000_000) return n
      }
    }
  }
  return null
}

/** Harvest a code-named tab ("310 Window Sill") as working lines. Generic
 *  reading: first row that looks like data onward; description = longest
 *  text cell, last numeric = amount, prior numerics = qty/rate best-effort. */
function harvestWorking(aoa: unknown[][], cap = 60): IBWorkingLine[] {
  const out: IBWorkingLine[] = []
  for (let i = 0; i < aoa.length && out.length < cap; i++) {
    const r = aoa[i] ?? []
    const texts = r.map(str).filter(Boolean)
    if (texts.length === 0) continue
    const nums = r.map(toNum).filter((n): n is number => n != null)
    const desc = texts.reduce((a, b) => (b.length > a.length ? b : a), '')
    if (!desc && nums.length === 0) continue
    // Heuristic slots: [... qty, rate, amount] from the trailing numerics.
    const amount = nums.length >= 1 ? nums[nums.length - 1] : null
    const rate   = nums.length >= 2 ? nums[nums.length - 2] : null
    const qty    = nums.length >= 3 ? nums[nums.length - 3] : null
    // Unit: a short all-letters cell like Sft/Nos/Rmt/Cum/Kg.
    const unit = r.map(str).find(s => /^(sft|smt|sqm|rmt|cum|nos|kg|mt|ltr|ls|each|hrs)\.?$/i.test(s)) ?? null
    out.push({ row_no: out.length + 1, description: desc || null, unit, qty, rate, amount })
  }
  return out
}

/** Map workbook tab names to the sub-skill codes they carry ("1204 1205
 *  Flooring & dado" → 1204 and 1205 both point at that tab). */
export function tabCodeMap(sheets: SheetInput[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const s of sheets.slice(1)) { // never the main grid itself
    const codes = s.name.match(/\b\d{3,4}\b/g) ?? []
    for (const code of codes) {
      if (!map.has(code)) map.set(code, s.name)
    }
  }
  return map
}

export function parseInternalBudget(sheets: SheetInput[]): InternalBudget {
  const fail = (reason: string): InternalBudget => ({
    sheetName: sheets[0]?.name ?? '?', areaSft: null, grandTotal: null,
    grandTotalSource: null, moneySource: null, disciplines: [], skipped: [],
    itemSum: 0, parseOk: false, failReason: reason,
  })
  if (!sheets.length) return fail('empty workbook')

  const main = sheets[0]
  const aoa = main.aoa ?? []

  // Header row: "Work Category …" and "Sub Skill …" — the ANCHOR COLUMNS
  // shift per variant (buildings: A/B; infra: B/C), so find them by label.
  let headerIdx = -1
  let colA = 0
  let colB = 1
  for (let i = 0; i < Math.min(aoa.length, 15); i++) {
    const r = aoa[i] ?? []
    const ia = r.findIndex(v => /work\s*category/i.test(str(v)))
    if (ia < 0) continue
    const ib = r.findIndex((v, j) => j > ia && /sub\s*skill/i.test(str(v)))
    if (ib < 0) continue
    headerIdx = i; colA = ia; colB = ib
    break
  }
  if (headerIdx < 0) return fail('standard header row (Work Category / Sub Skill) not found')

  const header = aoa[headerIdx] ?? []
  const subLabels = aoa[headerIdx + 1] ?? []
  // Only group labels to the RIGHT of the Sub Skill column can be money
  // pairs ("Sub Skill / Expense Sub Type" itself must never match).
  const maskedHeader = header.map((v, j) => (j > colB ? v : null))
  const pairs = findMoneyPairs(maskedHeader, subLabels)
  if (pairs.length === 0) return fail('no money column pair found')

  const areaSft = findArea(aoa, headerIdx)
  const codeTabs = tabCodeMap(sheets)
  const tabByName = new Map(sheets.map(s => [s.name, s]))

  // Footer boundary: "Total Amount with GST" row (contingency rows follow).
  let footerIdx = aoa.length
  for (let i = headerIdx + 2; i < aoa.length; i++) {
    if (/total\s*amount\s*with\s*gst/i.test(str(cell(aoa[i], colA)))) { footerIdx = i; break }
  }

  // Walk the grid once per candidate pair; keep the preferred non-zero one.
  const order: IBMoneySource[] = ['internal_estimated', 'amt', 'consultants']
  let winner: { pair: Pair; disciplines: IBDiscipline[]; skipped: InternalBudget['skipped']; itemSum: number } | null = null

  for (const source of order) {
    const pair = pairs.find(p => p.source === source)
    if (!pair) continue

    const disciplines: IBDiscipline[] = []
    const skipped: InternalBudget['skipped'] = []
    let current: IBDiscipline | null = null
    let itemSum = 0

    // Remark: first non-numeric text cell to the right of the money pair.
    const remarkFrom = Math.max(pair.item, pair.cat ?? pair.item) + 1
    const remarkOf = (r: unknown[]): string | null => {
      for (let j = remarkFrom; j < r.length; j++) {
        const s = str(r[j])
        if (s.length > 2 && toNum(r[j]) == null) return s
      }
      return null
    }

    for (let i = headerIdx + 2; i < footerIdx; i++) {
      const r = aoa[i] ?? []
      const a = str(cell(r, colA))
      const b = str(cell(r, colB))

      const dm = a.match(DISC_RE)
      if (dm) {
        current = {
          code: dm[1],
          name: a.replace(DISC_STRIP, '').trim() || a.trim(),
          categoryTotal: pair.cat != null ? toNum(cell(r, pair.cat)) : null,
          subSkills: [],
          reconDelta: null,
        }
        disciplines.push(current)
        continue
      }
      if (a && !b) {
        // Prose section heading without a 2-digit code — the infra variant
        // groups this way ("Compound Wall", "Earthworks"). It IS a category:
        // open a discipline for it (code derived later from its first coded
        // sub-skill) so the rows under it are captured, not skipped.
        current = {
          code: null,
          name: a,
          categoryTotal: pair.cat != null ? toNum(cell(r, pair.cat)) : null,
          subSkills: [],
          reconDelta: null,
        }
        disciplines.push(current)
        continue
      }

      const sm = b.match(SUB_RE)
      if (sm) {
        const amount = toNum(cell(r, pair.item)) ?? 0
        if (amount === 0) continue // empty budget line — not a working sheet
        const code = sm[1]
        // The sub-code names its discipline: 302 → 03, 1605 → 16, 5301 → 53.
        const derivedDisc = code.length === 3 ? '0' + code[0] : code.slice(0, 2)
        if (current) {
          // The author's section grouping wins; a prose section gets its
          // discipline code from its first coded sub-skill.
          if (current.code == null) current.code = derivedDisc
        } else {
          current = disciplines.find(d => d.code === derivedDisc) ?? null
          if (!current) {
            current = {
              code: derivedDisc,
              name: `Category ${derivedDisc}`,
              categoryTotal: null,
              subSkills: [],
              reconDelta: null,
            }
            disciplines.push(current)
          }
        }
        const name = b.replace(SUB_STRIP, '').trim() || b.trim()
        const remark = remarkOf(r)
        // Decimal variants (715.1, 715.2 …) roll up under the master code.
        const existing = current.subSkills.find(s => s.code === code)
        if (existing) {
          existing.amount += amount
          if (!existing.name.includes(name)) existing.name = `${existing.name} + ${name}`.slice(0, 200)
          if (remark && !existing.remark) existing.remark = remark
        } else {
          const tabName = codeTabs.get(code) ?? null
          const tab = tabName ? tabByName.get(tabName) : null
          current.subSkills.push({
            code,
            name,
            amount,
            working: tab ? harvestWorking(tab.aoa) : null,
            workingSheetName: tabName,
            remark,
          })
        }
        itemSum += amount
        continue
      }
      // Uncoded prose row with money ("Substation/HT Building", "CSS",
      // "RCC Retaining Walls - C") — real budget lines in the infra variant.
      // Capture them as code-null sub-skills so no money is lost; the
      // ingestion step decides how they map to the masters.
      const looseAmt = toNum(cell(r, pair.item))
      if (b && looseAmt != null && looseAmt !== 0) {
        if (!current) {
          skipped.push({ rowIdx: i, text: b, reason: 'money row before any category' })
          continue
        }
        current.subSkills.push({
          code: null,
          name: b,
          amount: looseAmt,
          working: null,
          workingSheetName: null,
          remark: remarkOf(r),
        })
        itemSum += looseAmt
      }
    }

    for (const d of disciplines) {
      // A category whose money sits ONLY on its heading row ("Special Item -
      // Auditorium" ₹69.5L, "Actual Staff Cost") is a lump figure — capture
      // it as a single sub-skill so the money is never lost.
      if (d.subSkills.length === 0 && (d.categoryTotal ?? 0) !== 0) {
        d.subSkills.push({
          code: null,
          name: d.name,
          amount: d.categoryTotal!,
          working: null,
          workingSheetName: null,
          remark: 'Category-level lump figure (no item rows in the budget)',
        })
        itemSum += d.categoryTotal!
      }
      const s = d.subSkills.reduce((x, y) => x + y.amount, 0)
      d.reconDelta = d.categoryTotal != null && d.categoryTotal !== 0 ? Math.abs(s - d.categoryTotal) : null
    }

    if (itemSum > 0) { winner = { pair, disciplines, skipped, itemSum }; break }
    if (!winner) winner = { pair, disciplines, skipped, itemSum } // keep first as fallback
  }

  if (!winner) return fail('no parseable money pair')

  // Grand total from the footer row: value in the winning pair's category
  // (or itemwise) column, else the row's max numeric.
  let grandTotal: number | null = null
  let grandTotalSource: InternalBudget['grandTotalSource'] = null
  if (footerIdx < aoa.length) {
    const fr = aoa[footerIdx] ?? []
    grandTotal = (winner.pair.cat != null ? toNum(cell(fr, winner.pair.cat)) : null)
      ?? toNum(cell(fr, winner.pair.item))
    if (grandTotal == null || grandTotal === 0) {
      const nums = fr.map(toNum).filter((n): n is number => n != null && n > 0)
      grandTotal = nums.length ? Math.max(...nums) : null
    }
    if (grandTotal != null) grandTotalSource = 'footer'
  }
  if (grandTotal == null && winner.itemSum > 0) {
    grandTotal = winner.itemSum
    grandTotalSource = 'sum'
  }

  return {
    sheetName: main.name,
    areaSft,
    grandTotal,
    grandTotalSource,
    moneySource: winner.pair.source,
    disciplines: winner.disciplines.filter(d => d.subSkills.length > 0 || (d.categoryTotal ?? 0) !== 0),
    skipped: winner.skipped,
    itemSum: winner.itemSum,
    parseOk: winner.itemSum > 0,
    failReason: winner.itemSum > 0 ? null : 'all candidate money columns are zero/empty',
  }
}
