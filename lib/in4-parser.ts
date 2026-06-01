// Pure helpers for IN4 Excel parsing — no Supabase, no React. Easy to unit-test.
//
// Two IN4 reports are supported:
//   1. ENGGBOQABSTRACTREPORT_New.xlsx — sectioned by Work Order with Sub-BOQ rows
//      carrying real unit rates. Primary populator of est_rates.
//   2. ENGGWorkOrderDetailReport.xlsx — flat table of WOs with lumpsum totals.
//      Feeds est_wo_history.

// ─── Short-name generator ───────────────────────────────────────────────
// IN4 sub-BOQ descriptions are often 100-300 chars and prefixed with junk
// ("Civil Work Material Related 305 Masonry work \\ ..."). Pick the most
// useful 60 chars so the rate library stays scannable.
const SHORT_NAME_PREFIX_GARBAGE = [
  /^Civil Work Material Related\s+\d+\s+/i,
  /^Electrical Work Material Related\s+\d+\s+/i,
  /^\d+\s+[\w ]+\\\s+/,             // e.g. "03 Civil \\ Civil Item Base Rate"
  /^Civil Work\s*\\\s*/i,
]

export function shortenName(full: string | null | undefined): string {
  if (!full) return ''
  let s = String(full).trim().replace(/\s+/g, ' ')
  for (const re of SHORT_NAME_PREFIX_GARBAGE) {
    s = s.replace(re, '')
  }
  // Cut at first ". " or " - " if early sentence captures the gist
  const breakpoints = ['. ', ' - ', ' — ', ' ('] as const
  for (const bp of breakpoints) {
    const idx = s.indexOf(bp)
    if (idx > 12 && idx < 70) { s = s.slice(0, idx); break }
  }
  if (s.length > 60) s = s.slice(0, 57).trimEnd() + '…'
  return s.trim()
}

// ─── Vendor / contractor classification ─────────────────────────────────

const CONTRACTOR_HINTS = [
  'construction', 'engineer', 'contractor', 'builder', 'fabricator',
  'fabrication', 'enterprises', 'industries',
]

/** Best-effort split between material vendors and labour/machinery contractors.
 *  Names containing engineering / construction keywords → contractor.
 *  Anything else → vendor. Admin can re-classify after import via the UI. */
export function classifyAsContractor(rawName: string): boolean {
  const n = (rawName || '').toLowerCase()
  return CONTRACTOR_HINTS.some(h => n.includes(h))
}

// ─── Section header ───────────────────────────────────────────────────────
// Example: "Accu Tape Engineers - WO/SRASSK/ND/2023-24/12 - WO Start Date: Apr 01, 2023, WO End Date: Jun 30, 2023"
const SECTION_HEADER_RE =
  /^\s*(.+?)\s+-\s+(WO\/[^\s-]+(?:-\d+)?\/\d+(?:-\d+)?\/\d+)\s+-\s+WO Start Date:\s*([A-Za-z]{3}\s+\d{1,2},\s*\d{4}),\s*WO End Date:\s*([A-Za-z]{3}\s+\d{1,2},\s*\d{4})\s*$/

export interface SectionHeader {
  contractor: string
  woNumber: string
  validFrom: string  // ISO yyyy-mm-dd
  validTill: string  // ISO yyyy-mm-dd
}

function parseDate(s: string): string {
  // "Apr 01, 2023" → "2023-04-01"
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseSectionHeader(cell: string): SectionHeader | null {
  if (!cell || typeof cell !== 'string') return null
  const m = cell.match(SECTION_HEADER_RE)
  if (!m) return null
  return {
    contractor: m[1].trim(),
    woNumber:   m[2].trim(),
    validFrom:  parseDate(m[3]),
    validTill:  parseDate(m[4]),
  }
}

// ─── Discipline / category ────────────────────────────────────────────────
// Discipline row: col A non-empty with format " 03 Civil" (leading space, code, name)
// Category row:   col B non-empty with format "317 Civil Contractor Cost"
const TAXONOMY_LINE_RE = /^\s*(\d+)\s+(.+?)\s*(?:-\s*MAIN CATEGORY)?\s*$/

export interface TaxonomyLine {
  code: string
  name: string
}

export function parseTaxonomyLine(raw: string): TaxonomyLine | null {
  if (!raw || typeof raw !== 'string') return null
  const m = raw.match(TAXONOMY_LINE_RE)
  if (!m) return null
  return { code: m[1], name: m[2].trim() }
}

// ─── Number cleaning ──────────────────────────────────────────────────────
// IN4 exports rates like "$11,000.00" — strip currency, commas.
export function parseAmount(raw: string | number | null | undefined): number {
  if (raw == null) return 0
  if (typeof raw === 'number') return raw
  const cleaned = String(raw).replace(/[^0-9.\-]/g, '')
  if (cleaned === '' || cleaned === '-') return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

// ─── Abstract Report row classification ───────────────────────────────────
export type AbstractRow =
  | { kind: 'title' }                                  // first 4 title rows
  | { kind: 'header' }                                  // row 5 column headers
  | { kind: 'project' }                                 // "Project Name: ..., Sub-Project Name: ..."
  | { kind: 'section'; header: SectionHeader }
  | { kind: 'discipline'; line: TaxonomyLine }
  | { kind: 'category'; line: TaxonomyLine }
  | { kind: 'boq';      description: string; uom: string; rate: number; wo_qty: number }
  | { kind: 'sub_boq';  description: string; uom: string; rate: number; wo_qty: number; consumed_qty: number; balance_qty: number; pct_complete: number }
  | { kind: 'blank' }

/** Classify one row from the Abstract Report. Pass the raw `string[]` for the
 *  row (zero-indexed columns from sheet_to_json with header: 1). */
export function classifyAbstractRow(cols: (string | number | null | undefined)[]): AbstractRow {
  const s = (i: number) => String(cols[i] ?? '').trim()
  const A = s(0), B = s(1), C = s(2), D = s(3), E = s(4)
  const all = cols.filter(c => c !== '' && c != null).length

  if (all === 0) return { kind: 'blank' }

  // Project header — col A starts with "Project Name:"
  if (A.startsWith('Project Name')) return { kind: 'project' }

  // Section header — col A contains the contractor+WO line
  const hdr = parseSectionHeader(A)
  if (hdr) return { kind: 'section', header: hdr }

  // Discipline row — col A populated like " 03 Civil"
  if (A && !B && !C) {
    const t = parseTaxonomyLine(A)
    if (t) return { kind: 'discipline', line: t }
  }

  // Category row — col B populated
  if (!A && B && !C) {
    const t = parseTaxonomyLine(B)
    if (t) return { kind: 'category', line: t }
  }

  // BOQ row — col C === 'BOQ'
  if (C === 'BOQ') {
    return {
      kind: 'boq',
      description: E,
      uom: s(9),
      rate: parseAmount(s(7)),
      wo_qty: parseAmount(s(8)),
    }
  }

  // Sub-BOQ row — col C === 'Sub-BOQ'
  if (C === 'Sub-BOQ') {
    return {
      kind: 'sub_boq',
      description:  E,
      uom:          s(9),
      rate:         parseAmount(s(7)),
      wo_qty:       parseAmount(s(8)),
      consumed_qty: parseAmount(s(10)),
      balance_qty:  parseAmount(s(11)),
      pct_complete: parseAmount(s(12)),
    }
  }

  return { kind: 'blank' }
}

// ─── Stateful walk producing extracted rows ───────────────────────────────

export interface AbstractExtract {
  disciplines: Map<string, TaxonomyLine>          // code → { code, name }
  categories:  Map<string, { discCode: string; code: string; name: string }> // disc+code → ...
  subcategories: Map<string, { categoryKey: string; name: string; uom: string }> // catKey+name → ...
  rates: Array<{
    discCode: string
    catCode: string
    subName: string
    uom: string
    contractor: string
    wo: string
    validFrom: string
    validTill: string
    rate: number
  }>
  woHistory: Array<{
    contractor: string
    wo: string
    validFrom: string
    validTill: string
    discCode: string
    catCode: string
    inDiscRaw: string
    inCatRaw: string
    workDescription: string
    baseValue: number  // sum of Sub-BOQ qty × rate, best-effort
  }>
}

export function extractFromAbstract(rows: (string | number | null | undefined)[][]): AbstractExtract {
  const out: AbstractExtract = {
    disciplines: new Map(),
    categories: new Map(),
    subcategories: new Map(),
    rates: [],
    woHistory: [],
  }

  let curSection: SectionHeader | null = null
  let curDisc: TaxonomyLine | null = null
  let curCat: TaxonomyLine | null = null
  let curWoDescription = ''
  let curWoLumpsum = 0

  function flushWoHistory() {
    if (curSection && curDisc && curCat) {
      out.woHistory.push({
        contractor: curSection.contractor,
        wo: curSection.woNumber,
        validFrom: curSection.validFrom,
        validTill: curSection.validTill,
        discCode: curDisc.code,
        catCode: curCat.code,
        inDiscRaw: `${curDisc.code} ${curDisc.name}`,
        inCatRaw: `${curCat.code} ${curCat.name}`,
        workDescription: curWoDescription,
        baseValue: curWoLumpsum,
      })
    }
    curWoDescription = ''
    curWoLumpsum = 0
  }

  for (const r of rows) {
    const c = classifyAbstractRow(r)
    switch (c.kind) {
      case 'section': {
        if (curSection) flushWoHistory()
        curSection = c.header
        curDisc = null
        curCat = null
        break
      }
      case 'discipline': {
        curDisc = c.line
        if (!out.disciplines.has(curDisc.code)) out.disciplines.set(curDisc.code, curDisc)
        break
      }
      case 'category': {
        if (!curDisc) break  // category without discipline → skip
        curCat = c.line
        const k = `${curDisc.code}|${curCat.code}`
        if (!out.categories.has(k)) {
          out.categories.set(k, { discCode: curDisc.code, code: curCat.code, name: curCat.name })
        }
        break
      }
      case 'boq': {
        // The first BOQ description per WO is the "work description"
        if (!curWoDescription) curWoDescription = c.description
        break
      }
      case 'sub_boq': {
        if (!curSection || !curDisc || !curCat) break
        if (!c.description) break
        const catKey = `${curDisc.code}|${curCat.code}`
        const subKey = `${catKey}|${c.description}`
        if (!out.subcategories.has(subKey)) {
          out.subcategories.set(subKey, {
            categoryKey: catKey,
            name: c.description,
            uom: c.uom || 'Nos',
          })
        }
        if (c.rate > 0) {
          out.rates.push({
            discCode: curDisc.code,
            catCode: curCat.code,
            subName: c.description,
            uom: c.uom || 'Nos',
            contractor: curSection.contractor,
            wo: curSection.woNumber,
            validFrom: curSection.validFrom,
            validTill: curSection.validTill,
            rate: c.rate,
          })
          curWoLumpsum += c.rate * c.wo_qty
        }
        break
      }
    }
  }

  if (curSection) flushWoHistory()
  return out
}

// ─── WO Detail Report row mapping ────────────────────────────────────────
// Headers in row 5. Useful columns:
//   0  SL No
//   2  Project
//   5  Sub Project
//   6  Work Order Number
//   7  Contractor/Consultant
//   8  Work Description
//   9  Work Category
//  10  Work Sub Category
//  11  From Date (Tentative)
//  12  To Date   (Tentative)
//  13  Status
//  16  Scope of Work
//  17  Remarks
//  19  Work Order Base Value
//  20  Total Tax
//  21  Total Value (depends on file; we treat 19+20 as total if 21 missing)

export interface WoDetailRow {
  wo_number: string
  project_name: string
  sub_project_name: string
  contractor_name: string
  work_description: string
  in4_work_category: string
  in4_work_sub_category: string
  from_date: string
  to_date: string
  status: string
  scope_of_work: string
  remarks: string
  base_value: number
  total_tax: number
  total_value: number
}

export function extractWoDetailRow(cols: (string | number | null | undefined)[]): WoDetailRow | null {
  const s = (i: number) => String(cols[i] ?? '').trim()
  const wo = s(6)
  if (!wo || !wo.startsWith('WO/')) return null
  return {
    wo_number:            wo,
    project_name:         s(2),
    sub_project_name:     s(5),
    contractor_name:      s(7),
    work_description:     s(8),
    in4_work_category:    s(9),
    in4_work_sub_category: s(10),
    from_date:            parseDate(s(11)),
    to_date:              parseDate(s(12)),
    status:               s(13),
    scope_of_work:        s(16),
    remarks:              s(17),
    base_value:           parseAmount(s(19)),
    total_tax:            parseAmount(s(20)),
    total_value:          parseAmount(s(21)) || parseAmount(s(19)) + parseAmount(s(20)),
  }
}
