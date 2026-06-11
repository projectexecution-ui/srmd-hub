// Pure logic for the IN4 Supplier Report. Ingests the RAW IN4 "All Purchase
// Payments Report" export (PURAllPurchasePaymentsReport), tags each
// certificate row with its project + sub-project, and aggregates per
// Project → Sub-project → Material Category → Supplier. Modelled on the
// Contractor Report (lib/contractor-report.ts) so the two feel identical.
//
// Source layout (header row 3, 0-indexed; 30 columns):
//   [0]  PO. No.                  [22] Total Cost (G = D+E−F)   ← the "bill"
//   [2]  Certificate Type         [23] Adv Recovered (H)
//   [3]  Cert. No.                [24] Debit Note Recovered (I)
//   [7]  Status                   [25] Retention Amount (J)
//   [8]  Vendor Name  (supplier)  [26] Net Payable Amt (K = G−H−I−J)
//   [10] Material/Asset Type (cat)[28] Paid Amt (L)
//   [17] Tax Deductions           [29] Outstanding Amt (K−L)
// Markers are 3 separate rows in col 3:
//   "COMPANY NAME : …", "PROJECT NAME : X", "SUBPROJECT NAME : Y".
// Each sub-project block ends with a "Total(s) :" row (col 11) whose col 22
// subtotals Total Cost — that's the figure we reconcile against.
//
// Derived (mirrors the IN4 columns, which already net everything out):
//   Bill (Total Cost G) · Recoveries (H+I) · Retention (J)
//   Net Payable (K) = G − H − I − J · Paid (L) · Outstanding (K − L)

import { parseAmount } from './in4-parser'

type Cell = string | number | null | undefined
export type Sheet = Cell[][]

const C = {
  po: 0, certType: 2, certNo: 3, status: 7, vendor: 8, category: 10,
  invAmt: 14, taxDeduction: 17, totalCost: 22,
  advRecovered: 23, debitRecovered: 24, retention: 25,
  netPayable: 26, paid: 28, outstanding: 29,
  marker: 3, totalMarker: 11,
} as const

export interface RawSupplier {
  supplier: string
  billValue: number       // Total Cost (G) — the certified value incl. tax
  recoveries: number      // Adv Recovered (H) + Debit Note Recovered (I)
  taxDeduction: number    // Tax Deductions (TDS-like)
  retentionHeld: number   // Retention Amount (J)
  netPayable: number      // Net Payable (K) = G − H − I − J
  paidValue: number       // Paid (L)
  outstanding: number     // Outstanding (K − L) — still to pay
}

export interface RawCategory {
  category: string
  suppliers: RawSupplier[]
}

/** A sub-project section: its categories. */
export interface SubprojectGroup {
  name: string
  categories: RawCategory[]
}

/** IN4-reported subtotal we can reconcile against. The "Total(s)" row only
 *  subtotals Total Cost (col 22), so that's the one figure we verify. */
export interface In4Source {
  billValue: number
}

export interface ReportDoc {
  id: string
  projectName: string
  title: string
  subtitle: string
  sourceFilename: string
  uploadedAt: string
  subprojects: SubprojectGroup[]
  /** Sum of computed Total Cost across detail rows (for reconciliation). */
  computedBill: number
  /** Sum of the IN4 "Total(s)" rows for this project, or null if none found. */
  source: In4Source | null
  /** Manual built-up area (sq ft) per sub-project name. */
  areaBySub?: Record<string, number>
}

/** Which amount the "% of cost" and "Rs/Sft" metrics divide / share. */
export type CostBase = 'bill' | 'net' | 'paid'
export const COST_BASE_OPTIONS: { value: CostBase; label: string }[] = [
  { value: 'bill', label: 'Total Bill Value' },
  { value: 'net',  label: 'Net Payable' },
  { value: 'paid', label: 'Total Paid' },
]
export function costOf(t: { billValue: number; netPayable: number; paidValue: number }, base: CostBase): number {
  return base === 'net' ? t.netPayable : base === 'paid' ? t.paidValue : t.billValue
}

export interface SupplierReportSettings {
  costBase?: CostBase
  /** Show % of Cost + Rs/Sft columns in the table + Excel export. Defaults to true. */
  showMetrics?: boolean
}
export interface SupplierReportState { reports: ReportDoc[]; settings?: SupplierReportSettings }

export interface Totals {
  billValue: number
  recoveries: number
  taxDeduction: number
  retentionHeld: number
  netPayable: number
  paidValue: number
  outstanding: number
}

const str = (c: Cell): string => (c == null ? '' : String(c).trim())
const rawStr = (c: Cell): string => (c == null ? '' : String(c))
const num = (row: Cell[], i: number) => parseAmount(row[i])

// ─── Sums ──────────────────────────────────────────────────────────────────

const ZERO: Totals = {
  billValue: 0, recoveries: 0, taxDeduction: 0, retentionHeld: 0,
  netPayable: 0, paidValue: 0, outstanding: 0,
}

export function sumSuppliers(rows: RawSupplier[]): Totals {
  return rows.reduce<Totals>((t, s) => ({
    billValue: t.billValue + s.billValue,
    recoveries: t.recoveries + s.recoveries,
    taxDeduction: t.taxDeduction + s.taxDeduction,
    retentionHeld: t.retentionHeld + s.retentionHeld,
    netPayable: t.netPayable + s.netPayable,
    paidValue: t.paidValue + s.paidValue,
    outstanding: t.outstanding + s.outstanding,
  }), { ...ZERO })
}

export const categorySubtotal = (cat: RawCategory): Totals => sumSuppliers(cat.suppliers)
export const subprojectTotal = (sp: SubprojectGroup): Totals => sumSuppliers(sp.categories.flatMap(c => c.suppliers))
export const reportGrandTotal = (sps: SubprojectGroup[]): Totals =>
  sumSuppliers(sps.flatMap(s => s.categories.flatMap(c => c.suppliers)))
export const displayCategory = (raw: string): string => raw.trim() || '(Uncategorised)'

/** Merge all sub-projects into a single flat category list (the "Combined"
 *  view): suppliers with the same (category, supplier) are summed. */
export function combineSubprojects(sps: SubprojectGroup[]): RawCategory[] {
  const catOrder: string[] = []
  const cats = new Map<string, RawCategory>()
  const sups = new Map<string, RawSupplier>()
  for (const sp of sps) {
    for (const cat of sp.categories) {
      if (!cats.has(cat.category)) { cats.set(cat.category, { category: cat.category, suppliers: [] }); catOrder.push(cat.category) }
      for (const s of cat.suppliers) {
        const k = `${cat.category}||${s.supplier}`
        const existing = sups.get(k)
        if (!existing) {
          const copy = { ...s }
          sups.set(k, copy)
          cats.get(cat.category)!.suppliers.push(copy)
        } else {
          existing.billValue += s.billValue
          existing.recoveries += s.recoveries
          existing.taxDeduction += s.taxDeduction
          existing.retentionHeld += s.retentionHeld
          existing.netPayable += s.netPayable
          existing.paidValue += s.paidValue
          existing.outstanding += s.outstanding
        }
      }
    }
  }
  return catOrder.map(k => cats.get(k)!)
}

// ─── Parsing the raw IN4 source ────────────────────────────────────────────

function findHeaderRow(rows: Sheet): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (str(rows[i]?.[C.po]) === 'PO. No.' && str(rows[i]?.[C.vendor]) === 'Vendor Name') return i
  }
  return 3
}

const afterColon = (s: string): string => {
  const idx = s.indexOf(':')
  return (idx >= 0 ? s.slice(idx + 1) : s).trim()
}

export interface ParsedSource {
  projectName: string
  title: string
  subtitle: string
  subprojects: SubprojectGroup[]
  computedBill: number
  source: In4Source | null
}

const SUBTITLE = 'Category-wise & Supplier-wise Summary (by Sub-project, INR)'
const emptyParsed = (name = 'Project'): ParsedSource => ({
  projectName: name,
  title: `${name} — Supplier Payments`,
  subtitle: SUBTITLE,
  subprojects: [],
  computedBill: 0,
  source: null,
})

// Per-project accumulator used by the multi-project walker.
interface ProjectAcc {
  projectName: string
  subOrder: string[]
  subs: Map<string, SubprojectGroup>
  catIndex: Map<string, RawCategory>      // `${sub}||${categoryRaw}`
  supIndex: Map<string, RawSupplier>      // `${sub}||${categoryRaw}||${supplier}`
  computedBill: number
  sourceBill: number
  sawTotal: boolean
}

/**
 * Parse a raw IN4 "All Purchase Payments Report" into ONE ParsedSource PER
 * PROJECT. A company-wide export carries many `PROJECT NAME:` markers, so we
 * group by that field — a single-project export simply yields a one-element
 * array (mirrors parseSourceReports in contractor-report.ts).
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
        supIndex: new Map(), computedBill: 0, sourceBill: 0, sawTotal: false,
      }
      projs.set(name, acc)
      projOrder.push(name)
    }
    return acc
  }

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] ?? []

    // Marker rows live in col 3. Test SUBPROJECT before PROJECT because
    // "SUBPROJECT NAME" contains the substring "PROJECT NAME".
    const marker = str(row[C.marker])
    if (marker) {
      if (/SUBPROJECT NAME/i.test(marker)) { currentSub = afterColon(marker) || '(Unknown Sub-project)'; continue }
      if (/PROJECT NAME/i.test(marker)) { currentProject = afterColon(marker) || currentProject; currentSub = '(Unknown Sub-project)'; continue }
      if (/COMPANY NAME/i.test(marker)) { continue }
    }

    // Sub-project subtotal row — its col 22 is the IN4 Total Cost we reconcile.
    if (/Total\(s\)/i.test(str(row[C.totalMarker]))) {
      const acc = accFor(currentProject)
      acc.sourceBill += num(row, C.totalCost)
      acc.sawTotal = true
      continue
    }

    const supplier = str(row[C.vendor])
    if (!supplier || supplier === 'Vendor Name') continue

    const categoryRaw = rawStr(row[C.category]).trim() || '(Uncategorised)'
    const bill = num(row, C.totalCost)
    const recoveries = num(row, C.advRecovered) + num(row, C.debitRecovered)
    const taxDed = num(row, C.taxDeduction)
    const retention = num(row, C.retention)
    const netPayable = num(row, C.netPayable)
    const paid = num(row, C.paid)
    const outstanding = num(row, C.outstanding)

    const acc = accFor(currentProject)
    acc.computedBill += bill

    if (!acc.subs.has(currentSub)) { acc.subs.set(currentSub, { name: currentSub, categories: [] }); acc.subOrder.push(currentSub) }
    const catKey = `${currentSub}||${categoryRaw}`
    if (!acc.catIndex.has(catKey)) {
      const rc: RawCategory = { category: categoryRaw, suppliers: [] }
      acc.catIndex.set(catKey, rc)
      acc.subs.get(currentSub)!.categories.push(rc)
    }
    const supKey = `${catKey}||${supplier}`
    if (!acc.supIndex.has(supKey)) {
      const ns: RawSupplier = { supplier, billValue: 0, recoveries: 0, taxDeduction: 0, retentionHeld: 0, netPayable: 0, paidValue: 0, outstanding: 0 }
      acc.supIndex.set(supKey, ns)
      acc.catIndex.get(catKey)!.suppliers.push(ns)
    }
    const a = acc.supIndex.get(supKey)!
    a.billValue += bill
    a.recoveries += recoveries
    a.taxDeduction += taxDed
    a.retentionHeld += retention
    a.netPayable += netPayable
    a.paidValue += paid
    a.outstanding += outstanding
  }

  return projOrder.map(p => {
    const acc = projs.get(p)!
    const name = acc.projectName || 'Project'
    return {
      projectName: name,
      title: `${name} — Supplier Payments`,
      subtitle: SUBTITLE,
      subprojects: acc.subOrder.map(s => acc.subs.get(s)!),
      computedBill: acc.computedBill,
      source: acc.sawTotal ? { billValue: acc.sourceBill } : null,
    }
  })
}

/** Back-compat single-project view: the FIRST project in the export. */
export function parseSourceReport(rows: Sheet): ParsedSource {
  const all = parseSourceReports(rows)
  return all.length > 0 ? all[0] : emptyParsed()
}

// ─── Reconciliation against IN4's own "Total(s)" rows ──────────────────────

export interface ReconLine { label: string; computed: number; source: number; delta: number; ok: boolean }
export interface ReconResult { available: boolean; allOk: boolean; lines: ReconLine[] }

export function reconcile(computedBill: number, source: In4Source | null): ReconResult {
  if (!source) return { available: false, allOk: true, lines: [] }
  const delta = computedBill - source.billValue
  const ok = Math.abs(delta) < 1
  return {
    available: true,
    allOk: ok,
    lines: [{ label: 'Total Cost (Bill)', computed: computedBill, source: source.billValue, delta, ok }],
  }
}
