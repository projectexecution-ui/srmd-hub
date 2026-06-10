// Pure logic for the IN4 Contractor Report. Ingests the RAW IN4 "All Types
// Certificates Details" export, tags each row with its sub-project, and
// aggregates per Sub-project → Category → Contractor. Verified against SRMD's
// own generated report (31/31 contractors matched).
//
// Source layout (header row 3, 0-indexed; 33 columns):
//   [0]  Work Category            [20] Gross Bill Amount
//   [2]  Work Order Number        [21] Advance Adj. Recovered
//   [4]  Contractor Name          [22] Misc Adj. Recovered
//   [5]  Work Order Value         [23] Material Adj Recovered
//   [25] Tax Deduction            [24] Debit Note Adj. Recovered
//   [26] Retention Amount         [31] Amount Paid
//   [27] Other Deduction          [32] Outstanding Amount
// Sub-project markers: col 0 "Company: … Project: X , Subproject: Y".
// Total rows: col 12 "… Total :".
//
// Derived columns (match the existing report + its Notes):
//   Bill = Gross − (Advance+Misc+Material+DebitNote recovered)
//   Deductions = Tax Deduction + Other Deduction; Retention = Retention Amount
//   Balance = Bill − Paid − Deductions − Retention; Total Owed = Balance + Retention

import { parseAmount } from './in4-parser'

type Cell = string | number | null | undefined
export type Sheet = Cell[][]

const C = {
  category: 0, wo: 2, contractor: 4, woValue: 5,
  grossBill: 20, advRecovered: 21, miscRecovered: 22, matRecovered: 23, debitRecovered: 24,
  taxDeduction: 25, retention: 26, otherDeduction: 27,
  amountPaid: 31, outstanding: 32, totalMarker: 12,
} as const

export interface RawContractor {
  contractor: string
  woValue: number
  billValue: number
  paidValue: number
  deductions: number
  retentionHeld: number
  outstanding: number
}

export interface ComputedContractor extends RawContractor {
  balanceValue: number
  totalOwed: number
}

export interface RawCategory {
  category: string
  contractors: RawContractor[]
}

/** A sub-project section: its categories + (implicitly) its own total. */
export interface SubprojectGroup {
  name: string
  categories: RawCategory[]
}

export interface In4Totals {
  grossBill: number
  recoveries: number
  paid: number
  deductions: number
  retention: number
  outstanding: number
}

export interface ReportDoc {
  id: string
  projectName: string
  title: string
  subtitle: string
  sourceFilename: string
  uploadedAt: string
  subprojects: SubprojectGroup[]
  computed: In4Totals
  source: In4Totals | null
  /** Manual built-up area (sq ft) per sub-project name — overrides the
   *  Budget-vs-Actual auto-match. */
  areaBySub?: Record<string, number>
}

/** Which amount the "% of cost" and "Rs/Sft" metrics divide / share. */
export type CostBase = 'bill' | 'wo' | 'paid'
export const COST_BASE_OPTIONS: { value: CostBase; label: string }[] = [
  { value: 'bill', label: 'Total Bill Value' },
  { value: 'wo',   label: 'WO Value' },
  { value: 'paid', label: 'Total Paid' },
]
export function costOf(t: { billValue: number; woValue: number; paidValue: number }, base: CostBase): number {
  return base === 'wo' ? t.woValue : base === 'paid' ? t.paidValue : t.billValue
}

export interface ContractorReportSettings {
  costBase?: CostBase
  /** Show % of Cost + Rs/Sft columns in the table + Excel export. Defaults to true. */
  showMetrics?: boolean
}
export interface ContractorReportState { reports: ReportDoc[]; settings?: ContractorReportSettings }

export interface Totals {
  woValue: number
  billValue: number
  paidValue: number
  deductions: number
  retentionHeld: number
  balanceValue: number
  totalOwed: number
}

const str = (c: Cell): string => (c == null ? '' : String(c).trim())
const rawStr = (c: Cell): string => (c == null ? '' : String(c))
const num = (row: Cell[], i: number) => parseAmount(row[i])

// ─── Derivations ───────────────────────────────────────────────────────────

export function deriveContractor(r: RawContractor): ComputedContractor {
  const balanceValue = r.billValue - r.paidValue - r.deductions - r.retentionHeld
  return { ...r, balanceValue, totalOwed: balanceValue + r.retentionHeld }
}

const ZERO: Totals = {
  woValue: 0, billValue: 0, paidValue: 0, deductions: 0,
  retentionHeld: 0, balanceValue: 0, totalOwed: 0,
}

export function sumContractors(rows: RawContractor[]): Totals {
  return rows.reduce<Totals>((t, raw) => {
    const c = deriveContractor(raw)
    return {
      woValue: t.woValue + c.woValue,
      billValue: t.billValue + c.billValue,
      paidValue: t.paidValue + c.paidValue,
      deductions: t.deductions + c.deductions,
      retentionHeld: t.retentionHeld + c.retentionHeld,
      balanceValue: t.balanceValue + c.balanceValue,
      totalOwed: t.totalOwed + c.totalOwed,
    }
  }, { ...ZERO })
}

export const categorySubtotal = (cat: RawCategory): Totals => sumContractors(cat.contractors)
export const subprojectTotal = (sp: SubprojectGroup): Totals => sumContractors(sp.categories.flatMap(c => c.contractors))
export const reportGrandTotal = (sps: SubprojectGroup[]): Totals =>
  sumContractors(sps.flatMap(s => s.categories.flatMap(c => c.contractors)))
export const displayCategory = (raw: string): string => raw.trim()

/** Merge all sub-projects into a single flat category list (the "Combined"
 *  view): contractors with the same (category, contractor) are summed. */
export function combineSubprojects(sps: SubprojectGroup[]): RawCategory[] {
  const catOrder: string[] = []
  const cats = new Map<string, RawCategory>()
  const cons = new Map<string, RawContractor>()
  for (const sp of sps) {
    for (const cat of sp.categories) {
      if (!cats.has(cat.category)) { cats.set(cat.category, { category: cat.category, contractors: [] }); catOrder.push(cat.category) }
      for (const c of cat.contractors) {
        const k = `${cat.category}||${c.contractor}`
        const existing = cons.get(k)
        if (!existing) {
          const copy = { ...c }
          cons.set(k, copy)
          cats.get(cat.category)!.contractors.push(copy)
        } else {
          existing.woValue += c.woValue
          existing.billValue += c.billValue
          existing.paidValue += c.paidValue
          existing.deductions += c.deductions
          existing.retentionHeld += c.retentionHeld
          existing.outstanding += c.outstanding
        }
      }
    }
  }
  return catOrder.map(k => cats.get(k)!)
}

// ─── Parsing the raw IN4 source ────────────────────────────────────────────

function findHeaderRow(rows: Sheet): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (str(rows[i]?.[C.category]) === 'Work Category' && str(rows[i]?.[C.contractor]) === 'Contractor Name') return i
  }
  return 3
}

const PROJECT_RE = /Project:\s*([^,]+?)\s*,\s*Subproject:/i
const SUBPROJECT_RE = /Subproject:\s*(.+?)\s*$/i

export interface ParsedSource {
  projectName: string
  title: string
  subtitle: string
  subprojects: SubprojectGroup[]
  computed: In4Totals
  source: In4Totals | null
}

const emptyTotals = (): In4Totals => ({ grossBill: 0, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 })
const emptyParsed = (name = 'Project'): ParsedSource => ({
  projectName: name,
  title: `${name} — Project Execution Expenses`,
  subtitle: 'Category-wise & Contractor-wise Summary (by Sub-project, INR)',
  subprojects: [],
  computed: emptyTotals(),
  source: null,
})

// Per-project accumulator used by the multi-project walker.
interface ProjectAcc {
  projectName: string
  subOrder: string[]
  subs: Map<string, SubprojectGroup>
  catIndex: Map<string, RawCategory>      // `${sub}||${categoryRaw}`
  conIndex: Map<string, RawContractor>    // `${sub}||${categoryRaw}||${contractor}`
  woSeen: Set<string>
  computed: In4Totals
  source: In4Totals | null
}

/**
 * Parse a raw IN4 export into ONE ParsedSource PER PROJECT.
 *
 * A company-wide "All Types Certificates Details" export carries many
 * `Project:` values in its sub-project markers. Earlier we only kept the
 * first one and lumped every sub-project under it (so one project's chip
 * showed the whole company). Now we group by the `Project:` field so each
 * project becomes its own report — a single-project export simply yields a
 * one-element array.
 */
export function parseSourceReports(rows: Sheet): ParsedSource[] {
  const headerRow = findHeaderRow(rows)
  let currentProject = 'Project'
  let currentSub = '(Unknown Sub-project)'

  const projOrder: string[] = []
  const projs = new Map<string, ProjectAcc>()
  const accFor = (name: string): ProjectAcc => {
    let acc = projs.get(name)
    if (!acc) {
      acc = {
        projectName: name, subOrder: [], subs: new Map(), catIndex: new Map(),
        conIndex: new Map(), woSeen: new Set(), computed: emptyTotals(), source: null,
      }
      projs.set(name, acc)
      projOrder.push(name)
    }
    return acc
  }

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const cell0 = str(row[C.category])

    // Sub-project / company marker — update BOTH the project and the sub.
    if (cell0.startsWith('Company:') || cell0.includes('Subproject:')) {
      const mp = cell0.match(PROJECT_RE)
      if (mp) currentProject = mp[1].trim() || currentProject
      const ms = cell0.match(SUBPROJECT_RE)
      currentSub = ms ? ms[1].trim() : '(Unknown Sub-project)'
      continue
    }

    // Total rows — a "Project Total" attaches to the CURRENT project's acc.
    const totalCell = str(row[C.totalMarker])
    if (/Total\s*:?\s*$/i.test(totalCell)) {
      if (/^Project Total/i.test(totalCell)) {
        accFor(currentProject).source = {
          grossBill: num(row, C.grossBill),
          recoveries: num(row, C.advRecovered) + num(row, C.miscRecovered) + num(row, C.matRecovered) + num(row, C.debitRecovered),
          paid: num(row, C.amountPaid),
          deductions: num(row, C.taxDeduction) + num(row, C.otherDeduction),
          retention: num(row, C.retention),
          outstanding: num(row, C.outstanding),
        }
      }
      continue
    }

    const categoryRaw = rawStr(row[C.category])
    const contractor = str(row[C.contractor])
    if (!categoryRaw.trim() || !contractor) continue
    if (categoryRaw.trim().startsWith('Company:')) continue

    const gross = num(row, C.grossBill)
    const recovered = num(row, C.advRecovered) + num(row, C.miscRecovered) + num(row, C.matRecovered) + num(row, C.debitRecovered)
    const paid = num(row, C.amountPaid)
    const ded = num(row, C.taxDeduction) + num(row, C.otherDeduction)
    const ret = num(row, C.retention)
    const out = num(row, C.outstanding)

    const acc = accFor(currentProject)
    acc.computed.grossBill += gross
    acc.computed.recoveries += recovered
    acc.computed.paid += paid
    acc.computed.deductions += ded
    acc.computed.retention += ret
    acc.computed.outstanding += out

    if (!acc.subs.has(currentSub)) { acc.subs.set(currentSub, { name: currentSub, categories: [] }); acc.subOrder.push(currentSub) }
    const catKey = `${currentSub}||${categoryRaw}`
    if (!acc.catIndex.has(catKey)) {
      const rc: RawCategory = { category: categoryRaw, contractors: [] }
      acc.catIndex.set(catKey, rc)
      acc.subs.get(currentSub)!.categories.push(rc)
    }
    const conKey = `${catKey}||${contractor}`
    if (!acc.conIndex.has(conKey)) {
      const nc: RawContractor = { contractor, woValue: 0, billValue: 0, paidValue: 0, deductions: 0, retentionHeld: 0, outstanding: 0 }
      acc.conIndex.set(conKey, nc)
      acc.catIndex.get(catKey)!.contractors.push(nc)
    }
    const a = acc.conIndex.get(conKey)!
    a.billValue += gross - recovered
    a.paidValue += paid
    a.deductions += ded
    a.retentionHeld += ret
    a.outstanding += out

    const woKey = `${conKey}||${str(row[C.wo])}`
    if (!acc.woSeen.has(woKey)) { acc.woSeen.add(woKey); a.woValue += num(row, C.woValue) }
  }

  return projOrder.map(p => {
    const acc = projs.get(p)!
    const name = acc.projectName || 'Project'
    return {
      projectName: name,
      title: `${name} — Project Execution Expenses`,
      subtitle: 'Category-wise & Contractor-wise Summary (by Sub-project, INR)',
      subprojects: acc.subOrder.map(s => acc.subs.get(s)!),
      computed: acc.computed,
      source: acc.source,
    }
  })
}

/**
 * Back-compat single-project view: the FIRST project in the export (or an
 * empty shell if there were no contractor rows). The UI uses
 * `parseSourceReports` so a multi-project file splits into many chips.
 */
export function parseSourceReport(rows: Sheet): ParsedSource {
  const all = parseSourceReports(rows)
  return all.length > 0 ? all[0] : emptyParsed()
}

// ─── Reconciliation against IN4's own Project Total row ────────────────────

export interface ReconLine { label: string; computed: number; source: number; delta: number; ok: boolean }
export interface ReconResult { available: boolean; allOk: boolean; lines: ReconLine[] }

export function reconcile(computed: In4Totals, source: In4Totals | null): ReconResult {
  if (!source) return { available: false, allOk: true, lines: [] }
  const line = (label: string, c: number, s: number): ReconLine =>
    ({ label, computed: c, source: s, delta: c - s, ok: Math.abs(c - s) < 1 })
  const lines = [
    line('Gross Bill', computed.grossBill, source.grossBill),
    line('Amount Paid', computed.paid, source.paid),
    line('Deductions (Tax + Other)', computed.deductions, source.deductions),
    line('Retention Held', computed.retention, source.retention),
    line('Outstanding', computed.outstanding, source.outstanding),
  ]
  return { available: true, allOk: lines.every(l => l.ok), lines }
}
