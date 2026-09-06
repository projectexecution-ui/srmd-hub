// The Contractor Report ("All Types Certificates Details"), built from IN4's
// certificate tables instead of the Excel export.
//
// What the Excel contains, worked out against the stored upload of 3 Sept 2026
// (Warehouse and Covered Seating Spaces reconciled to the rupee):
//   • every work-order certificate (Running, Final, Retention, SalesTax) that is
//     not cancelled — ENGG_RPT_WO_CERTIFICATE_DETAILS,
//   • every advance certificate that is not cancelled — BI.ENGG_ADVANCE_PAYMENTS_HEADER,
//   • every misc-payment certificate — BI.ENGG_MISC_PAYMENTS_HEADER.
// Gross = GROSS_AMT; recoveries = advance + misc + material + debit-note
// recovered (WO certificates only); paid = PAID_AMT (advances: payable −
// outstanding; misc: gross − tax − outstanding); deductions = tax + additional;
// retention; outstanding. Grouped exactly as the parser groups the Excel:
// project → sub-project → work category → contractor, with the WO value
// counted once per (contractor, category, WO).

import type { ReportDoc, RawCategory, RawContractor, SubprojectGroup, In4Totals } from '@/lib/contractor-report'

export interface In4ContractorCert {
  kind: 'wo' | 'advance' | 'misc'
  certificate_id: number
  certificate_type_id: number | null
  certificate_type: string | null
  wo_id: number | null
  wo_no: string | null
  wo_value: number
  project_id: number | null
  subproject_id: number
  skill_id: number | null
  subskill_id: number | null
  contractor_id: number | null
  status: number
  invoice_no: string | null
  invoice_date: string | null
  creation_dt: string | null
  gross: number
  recoveries: number
  paid: number
  deductions: number
  retention: number
  outstanding: number
  certified: number
}

export interface ContractorNames {
  projectName: (id: number | null) => string
  subprojectName: (id: number) => string
  skillName: (id: number | null) => string
  contractorName: (id: number | null) => string
}

/** Cancelled certificates never reach the export. */
export const CANCELLED_STATUSES = new Set([6])

const emptyTotals = (): In4Totals => ({ grossBill: 0, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 })

/** One ReportDoc per project, in the shape the Excel parser emits, so the
 *  Contractor Report page, its exports and Budget vs Actual V2 read it unchanged. */
export function buildContractorDocs(certs: In4ContractorCert[], names: ContractorNames, uploadedAt: string): ReportDoc[] {
  type Acc = {
    projectName: string; subOrder: string[]; subs: Map<string, SubprojectGroup>
    catIndex: Map<string, RawCategory>; conIndex: Map<string, RawContractor>; woSeen: Set<string>; computed: In4Totals
  }
  const projs = new Map<string, Acc>()
  const order: string[] = []
  const accFor = (name: string): Acc => {
    let a = projs.get(name)
    if (!a) { a = { projectName: name, subOrder: [], subs: new Map(), catIndex: new Map(), conIndex: new Map(), woSeen: new Set(), computed: emptyTotals() }; projs.set(name, a); order.push(name) }
    return a
  }

  // Stable order: by project name, then sub-project, then category, then
  // contractor — the Excel is sorted the same way.
  const sorted = [...certs]
    .filter(c => !CANCELLED_STATUSES.has(c.status))
    .sort((x, y) => names.projectName(x.project_id).localeCompare(names.projectName(y.project_id))
      || names.subprojectName(x.subproject_id).localeCompare(names.subprojectName(y.subproject_id))
      || categoryOf(x, names).localeCompare(categoryOf(y, names))
      || names.contractorName(x.contractor_id).localeCompare(names.contractorName(y.contractor_id)))

  for (const c of sorted) {
    const project = names.projectName(c.project_id)
    const sub = names.subprojectName(c.subproject_id)
    const category = categoryOf(c, names)
    const contractor = names.contractorName(c.contractor_id)
    if (!contractor) continue

    const acc = accFor(project)
    acc.computed.grossBill += c.gross
    acc.computed.recoveries += c.recoveries
    acc.computed.paid += c.paid
    acc.computed.deductions += c.deductions
    acc.computed.retention += c.retention
    acc.computed.outstanding += c.outstanding

    if (!acc.subs.has(sub)) { acc.subs.set(sub, { name: sub, categories: [] }); acc.subOrder.push(sub) }
    const catKey = `${sub}||${category}`
    if (!acc.catIndex.has(catKey)) {
      const rc: RawCategory = { category, contractors: [] }
      acc.catIndex.set(catKey, rc); acc.subs.get(sub)!.categories.push(rc)
    }
    const conKey = `${catKey}||${contractor}`
    if (!acc.conIndex.has(conKey)) {
      const nc: RawContractor = { contractor, woValue: 0, billValue: 0, paidValue: 0, deductions: 0, retentionHeld: 0, outstanding: 0 }
      acc.conIndex.set(conKey, nc); acc.catIndex.get(catKey)!.contractors.push(nc)
    }
    const a = acc.conIndex.get(conKey)!
    a.billValue += c.gross - c.recoveries
    a.paidValue += c.paid
    a.deductions += c.deductions
    a.retentionHeld += c.retention
    a.outstanding += c.outstanding
    const woKey = `${conKey}||${c.wo_no ?? ''}`
    if (!acc.woSeen.has(woKey)) { acc.woSeen.add(woKey); a.woValue += c.wo_value }
  }

  return order.map(p => {
    const acc = projs.get(p)!
    return {
      id: `in4-contractor-${slug(p)}`,
      projectName: p,
      title: `${p} — Project Execution Expenses`,
      subtitle: 'Category-wise & Contractor-wise Summary (by Sub-project, INR)',
      sourceFilename: 'IN4 live sync',
      uploadedAt,
      subprojects: acc.subOrder.map(s => acc.subs.get(s)!),
      computed: round(acc.computed),
      // The Excel carried IN4's own "Project Total" row to reconcile against.
      // Here the figures ARE IN4's, so the reconciliation is the comparison
      // with the last upload on /admin/in4, not a second total.
      source: null,
    }
  })
}

/** The Excel leaves the category cell with its leading space for most rows
 *  (" 03 Civil") — that spacing came from IN4's own report layout, not from the
 *  data. The parser's displayCategory trims it, so a trimmed name here reads
 *  the same on screen; the grouping is by trimmed name in both cases. */
function categoryOf(c: In4ContractorCert, names: ContractorNames): string {
  if (c.kind === 'misc') return 'Misc payments'
  return names.skillName(c.skill_id) || '(Uncategorised)'
}

function round(t: In4Totals): In4Totals {
  const r = (n: number) => Math.round(n * 100) / 100
  return { grossBill: r(t.grossBill), recoveries: r(t.recoveries), paid: r(t.paid), deductions: r(t.deductions), retention: r(t.retention), outstanding: r(t.outstanding) }
}

export function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }

/** Per-project comparison with the stored upload — the six figures the Excel's
 *  own Project Total row carried, so this is also a check of the source. */
export interface ReportComparisonRow { project: string; hub: In4Totals | null; in4: In4Totals | null; verdict: 'exact' | 'near' | 'off' | 'hub-only' | 'in4-only' }
export interface ReportComparison { comparedAt: string; uploadAt: string | null; rows: ReportComparisonRow[]; totals: { exact: number; near: number; off: number } }

export function compareContractor(hubDocs: Array<{ projectName: string; uploadedAt?: string; computed: In4Totals }>, in4Docs: ReportDoc[]): ReportComparison {
  const hub = new Map(hubDocs.map(d => [d.projectName, d.computed]))
  const in4 = new Map(in4Docs.map(d => [d.projectName, d.computed]))
  const rows: ReportComparisonRow[] = []
  for (const name of new Set([...hub.keys(), ...in4.keys()])) {
    const h = hub.get(name) ?? null, i = in4.get(name) ?? null
    rows.push({ project: name, hub: h, in4: i, verdict: verdictTotals(h, i) })
  }
  rows.sort((a, b) => (b.in4?.grossBill ?? b.hub?.grossBill ?? 0) - (a.in4?.grossBill ?? a.hub?.grossBill ?? 0))
  const uploadAt = hubDocs.map(d => d.uploadedAt ?? '').filter(Boolean).sort().pop() ?? null
  return {
    comparedAt: new Date().toISOString(), uploadAt, rows,
    totals: { exact: rows.filter(r => r.verdict === 'exact').length, near: rows.filter(r => r.verdict === 'near').length, off: rows.filter(r => r.verdict === 'off' || r.verdict === 'hub-only' || r.verdict === 'in4-only').length },
  }
}

export function verdictTotals(h: In4Totals | null, i: In4Totals | null): ReportComparisonRow['verdict'] {
  if (!h) return 'in4-only'
  if (!i) return 'hub-only'
  let worst: 'exact' | 'near' | 'off' = 'exact'
  for (const k of Object.keys(h) as Array<keyof In4Totals>) {
    const d = Math.abs((h[k] ?? 0) - (i[k] ?? 0))
    const v = d <= 1 ? 'exact' : d <= Math.max(Math.abs(h[k] ?? 0), Math.abs(i[k] ?? 0)) * 0.005 ? 'near' : 'off'
    if (v === 'off') return 'off'
    if (v === 'near') worst = 'near'
  }
  return worst
}
