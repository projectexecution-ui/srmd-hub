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

export function parseSourceReport(rows: Sheet): ParsedSource {
  const headerRow = findHeaderRow(rows)
  let projectName = ''
  let currentSub = '(Unknown Sub-project)'
  let source: In4Totals | null = null
  const computed: In4Totals = { grossBill: 0, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 }

  const subOrder: string[] = []
  const subs = new Map<string, SubprojectGroup>()
  const catIndex = new Map<string, RawCategory>()      // `${sub}||${categoryRaw}`
  const conIndex = new Map<string, RawContractor>()    // `${sub}||${categoryRaw}||${contractor}`
  const woSeen = new Set<string>()

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const cell0 = str(row[C.category])

    // Sub-project / company marker
    if (cell0.startsWith('Company:') || cell0.includes('Subproject:')) {
      const mp = cell0.match(PROJECT_RE)
      if (mp && !projectName) projectName = mp[1].trim()
      const ms = cell0.match(SUBPROJECT_RE)
      currentSub = ms ? ms[1].trim() : '(Unknown Sub-project)'
      continue
    }

    // Total rows
    const totalCell = str(row[C.totalMarker])
    if (/Total\s*:?\s*$/i.test(totalCell)) {
      if (/^Project Total/i.test(totalCell)) {
        source = {
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

    computed.grossBill += gross
    computed.recoveries += recovered
    computed.paid += paid
    computed.deductions += ded
    computed.retention += ret
    computed.outstanding += out

    if (!subs.has(currentSub)) { subs.set(currentSub, { name: currentSub, categories: [] }); subOrder.push(currentSub) }
    const catKey = `${currentSub}||${categoryRaw}`
    if (!catIndex.has(catKey)) {
      const rc: RawCategory = { category: categoryRaw, contractors: [] }
      catIndex.set(catKey, rc)
      subs.get(currentSub)!.categories.push(rc)
    }
    const conKey = `${catKey}||${contractor}`
    if (!conIndex.has(conKey)) {
      const nc: RawContractor = { contractor, woValue: 0, billValue: 0, paidValue: 0, deductions: 0, retentionHeld: 0, outstanding: 0 }
      conIndex.set(conKey, nc)
      catIndex.get(catKey)!.contractors.push(nc)
    }
    const a = conIndex.get(conKey)!
    a.billValue += gross - recovered
    a.paidValue += paid
    a.deductions += ded
    a.retentionHeld += ret
    a.outstanding += out

    const woKey = `${conKey}||${str(row[C.wo])}`
    if (!woSeen.has(woKey)) { woSeen.add(woKey); a.woValue += num(row, C.woValue) }
  }

  return {
    projectName: projectName || 'Project',
    title: `${projectName || 'Project'} — Project Execution Expenses`,
    subtitle: 'Category-wise & Contractor-wise Summary (by Sub-project, INR)',
    subprojects: subOrder.map(s => subs.get(s)!),
    computed,
    source,
  }
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
