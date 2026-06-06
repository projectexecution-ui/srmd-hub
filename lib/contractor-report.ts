// Pure logic for the IN4 Contractor Report. The module ingests the RAW IN4
// "All Types Certificates Details" export (the file uploaded frequently),
// aggregates it per Category × Contractor, and derives the report columns.
// Verified against SRMD's own generated report (31/31 contractors matched).
//
// Source layout (header row 3, 0-indexed; 33 columns):
//   [0]  Work Category            [20] Gross Bill Amount
//   [2]  Work Order Number        [21] Advance Adj. Recovered
//   [4]  Contractor Name          [22] Misc Adj. Recovered
//   [5]  Work Order Value         [23] Material Adj Recovered
//   [25] Tax Deduction            [24] Debit Note Adj. Recovered
//   [26] Retention Amount         [31] Amount Paid
//   [27] Other Deduction          [32] Outstanding Amount
// Subproject markers: col 0 "Company: … Project: X , Subproject: Y".
// Total rows: col 12 contains "… Total :" (Project / SubProject / etc.).
//
// Derived report columns (matches the existing report + its Notes):
//   Total Bill Value = Gross Bill − (Advance+Misc+Material+DebitNote recovered)
//   Deductions       = Tax Deduction + Other Deduction
//   Retention Held   = Retention Amount
//   Balance Value    = Bill − Paid − Deductions − Retention          [derived]
//   Total Owed       = Balance + Retention = Bill − Paid − Deductions [derived]

import { parseAmount } from './in4-parser'

type Cell = string | number | null | undefined
export type Sheet = Cell[][]

// Source column indices.
const C = {
  category: 0, wo: 2, contractor: 4, woValue: 5,
  grossBill: 20, advRecovered: 21, miscRecovered: 22, matRecovered: 23, debitRecovered: 24,
  taxDeduction: 25, retention: 26, otherDeduction: 27,
  amountPaid: 31, outstanding: 32,
  totalMarker: 12,
} as const

export interface RawContractor {
  contractor: string
  woValue: number
  billValue: number      // net of advances/recoveries
  paidValue: number
  deductions: number     // tax + other
  retentionHeld: number
  outstanding: number     // source Outstanding (reference / reconciliation)
}

export interface ComputedContractor extends RawContractor {
  balanceValue: number
  totalOwed: number
}

export interface RawCategory {
  category: string         // exact source string (leading space kept = subproject distinction)
  contractors: RawContractor[]
}

/** Grand sums of the underlying IN4 columns — used to reconcile against the
 *  source's own "Project Total" row so the user can trust the numbers. */
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
  categories: RawCategory[]
  computed: In4Totals          // summed from the rows we ingested
  source: In4Totals | null     // the IN4 "Project Total" row
}

export interface ContractorReportState { reports: ReportDoc[] }

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

// ─── Derivations (single source of truth for the formula columns) ──────────

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
export const grandTotal = (categories: RawCategory[]): Totals => sumContractors(categories.flatMap(c => c.contractors))

export const displayCategory = (raw: string): string => raw.trim()

// ─── Parsing the raw IN4 source ────────────────────────────────────────────

function findHeaderRow(rows: Sheet): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (str(rows[i]?.[C.category]) === 'Work Category' && str(rows[i]?.[C.contractor]) === 'Contractor Name') return i
  }
  return 3
}

const PROJECT_RE = /Project:\s*([^,]+?)\s*,\s*Subproject:/i

export interface ParsedSource {
  projectName: string
  title: string
  subtitle: string
  categories: RawCategory[]
  computed: In4Totals
  source: In4Totals | null
}

const num = (row: Cell[], i: number) => parseAmount(row[i])

/** Parse + aggregate a raw IN4 "All Types Certificates Details" export into a
 *  combined Category × Contractor report (one row per exact category string ×
 *  contractor). Captures the IN4 "Project Total" row for reconciliation. */
export function parseSourceReport(rows: Sheet): ParsedSource {
  const headerRow = findHeaderRow(rows)
  let projectName = ''
  let source: In4Totals | null = null

  // (category, contractor) → aggregate; WO values deduped per work order.
  const order: string[] = []
  const meta = new Map<string, { category: string; contractor: string }>()
  const acc = new Map<string, RawContractor>()
  const woSeen = new Set<string>()
  const computed: In4Totals = { grossBill: 0, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 }

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const cell0 = str(row[C.category])

    // Subproject / company marker
    if (cell0.startsWith('Company:') || cell0.includes('Subproject:')) {
      const m = cell0.match(PROJECT_RE)
      if (m && !projectName) projectName = m[1].trim()
      continue
    }

    // Total rows (col 12 = "Project Total :" / "SubProject Total :" / …)
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

    const categoryRaw = rawStr(row[C.category])    // keep leading space
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

    const key = `${categoryRaw}||${contractor}`
    if (!meta.has(key)) {
      meta.set(key, { category: categoryRaw, contractor })
      order.push(key)
      acc.set(key, { contractor, woValue: 0, billValue: 0, paidValue: 0, deductions: 0, retentionHeld: 0, outstanding: 0 })
    }
    const a = acc.get(key)!
    a.billValue += gross - recovered
    a.paidValue += paid
    a.deductions += ded
    a.retentionHeld += ret
    a.outstanding += out

    const woNum = str(row[C.wo])
    const woKey = `${key}||${woNum}`
    if (!woSeen.has(woKey)) { woSeen.add(woKey); a.woValue += num(row, C.woValue) }
  }

  // Group ordered (cat, contractor) keys into categories, preserving order.
  const categories: RawCategory[] = []
  const byCat = new Map<string, RawCategory>()
  for (const key of order) {
    const m = meta.get(key)!
    if (!byCat.has(m.category)) { const rc = { category: m.category, contractors: [] }; byCat.set(m.category, rc); categories.push(rc) }
    byCat.get(m.category)!.contractors.push(acc.get(key)!)
  }

  return {
    projectName: projectName || 'Project',
    title: `${projectName || 'Project'} — Project Execution Expenses`,
    subtitle: 'Category-wise & Contractor-wise Summary (All Subprojects, INR)',
    categories,
    computed,
    source,
  }
}

// ─── Reconciliation against IN4's own Project Total row ────────────────────

export interface ReconLine { label: string; computed: number; source: number; delta: number; ok: boolean }
export interface ReconResult { available: boolean; allOk: boolean; lines: ReconLine[] }

/** Compare the figures we summed against the source's "Project Total" row.
 *  The raw columns (Bill, Paid, Deductions, Retention, Outstanding) should
 *  tie to the rupee — proof every data row was read once and only once. */
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
