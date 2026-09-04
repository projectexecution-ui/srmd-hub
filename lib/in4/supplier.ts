// The Supplier Report ("All Purchase Payments Report"), built from IN4's
// supplier-payment facts instead of the Excel export.
//
// The Excel lists one row per certificate: payment certificates (the GRN-based
// bills — BI.FACT_PURCHASE_SUPPLIER_PAY, summed per certificate; "Total Cost"
// is the landed cost) and advance certificates (BI.FACT_PURCHASE_SUPPLIER_ADV_PAY;
// their "Total Cost" is the advance itself, with no material category, which
// the parser files under "(Uncategorised)"). The category of a payment
// certificate is the material TYPE of what it paid for — several types on one
// certificate are joined with a comma, as IN4 prints them. Cancelled
// certificates are left out. Verified against the upload of 3 Sept 2026:
// Admin Block, P2 Stepped Terraces, WC Reg Office and others to the rupee;
// the two biggest sites (Raj Uphaar, SRAH) within 1.5%, which the comparison
// on /admin/in4 shows rather than hides.

import type { ReportDoc, RawCategory, RawSupplier, SubprojectGroup } from '@/lib/supplier-report'
import { slug, type ReportComparisonRow } from './contractor'

export interface In4SupplierCert {
  kind: 'payment' | 'advance'
  certificate_id: number
  certificate_no: string | null
  project_id: number | null
  subproject_id: number
  supplier_id: number | null
  po_id: number | null
  status: number
  category: string | null
  certified: number
  landed: number
  tax_add: number
  tax_ded: number
  adv_recovery: number
  debit_note: number
  retention: number
  payable: number
  paid: number
  outstanding: number
}

export interface SupplierNames {
  projectName: (id: number | null) => string
  subprojectName: (id: number) => string
  supplierName: (id: number | null) => string
}

export const SUPPLIER_CANCELLED = new Set([6])

export function buildSupplierDocs(certs: In4SupplierCert[], names: SupplierNames, uploadedAt: string): ReportDoc[] {
  type Acc = { projectName: string; subOrder: string[]; subs: Map<string, SubprojectGroup>; catIndex: Map<string, RawCategory>; supIndex: Map<string, RawSupplier>; computedBill: number }
  const projs = new Map<string, Acc>()
  const order: string[] = []
  const accFor = (name: string): Acc => {
    let a = projs.get(name)
    if (!a) { a = { projectName: name, subOrder: [], subs: new Map(), catIndex: new Map(), supIndex: new Map(), computedBill: 0 }; projs.set(name, a); order.push(name) }
    return a
  }
  const catOf = (c: In4SupplierCert) => (c.category ?? '').trim() || '(Uncategorised)'

  const sorted = [...certs]
    .filter(c => !SUPPLIER_CANCELLED.has(c.status))
    .sort((x, y) => names.projectName(x.project_id).localeCompare(names.projectName(y.project_id))
      || names.subprojectName(x.subproject_id).localeCompare(names.subprojectName(y.subproject_id))
      || catOf(x).localeCompare(catOf(y))
      || names.supplierName(x.supplier_id).localeCompare(names.supplierName(y.supplier_id)))

  for (const c of sorted) {
    const supplier = names.supplierName(c.supplier_id)
    if (!supplier) continue
    const project = names.projectName(c.project_id)
    const sub = names.subprojectName(c.subproject_id)
    const category = catOf(c)
    const bill = c.kind === 'advance' ? c.landed : c.landed

    const acc = accFor(project)
    acc.computedBill += bill
    if (!acc.subs.has(sub)) { acc.subs.set(sub, { name: sub, categories: [] }); acc.subOrder.push(sub) }
    const catKey = `${sub}||${category}`
    if (!acc.catIndex.has(catKey)) {
      const rc: RawCategory = { category, suppliers: [] }
      acc.catIndex.set(catKey, rc); acc.subs.get(sub)!.categories.push(rc)
    }
    const supKey = `${catKey}||${supplier}`
    if (!acc.supIndex.has(supKey)) {
      const ns: RawSupplier = { supplier, billValue: 0, recoveries: 0, taxDeduction: 0, retentionHeld: 0, netPayable: 0, paidValue: 0, outstanding: 0 }
      acc.supIndex.set(supKey, ns); acc.catIndex.get(catKey)!.suppliers.push(ns)
    }
    const a = acc.supIndex.get(supKey)!
    a.billValue += bill
    a.recoveries += c.adv_recovery + c.debit_note
    a.taxDeduction += c.tax_ded
    a.retentionHeld += c.retention
    a.netPayable += c.payable
    a.paidValue += c.paid
    a.outstanding += c.outstanding
  }

  return order.map(p => {
    const acc = projs.get(p)!
    return {
      id: `in4-supplier-${slug(p)}`,
      projectName: p,
      title: `${p} — Supplier Payments`,
      subtitle: 'Category-wise & Supplier-wise Summary (by Sub-project, INR)',
      sourceFilename: 'IN4 live sync',
      uploadedAt,
      subprojects: acc.subOrder.map(s => acc.subs.get(s)!),
      computedBill: Math.round(acc.computedBill * 100) / 100,
      source: null,
    }
  })
}

export interface SupplierComparison { comparedAt: string; uploadAt: string | null; rows: Array<{ project: string; hub: number | null; in4: number | null; verdict: ReportComparisonRow['verdict'] }>; totals: { exact: number; near: number; off: number } }

export function compareSupplier(hubDocs: Array<{ projectName: string; uploadedAt?: string; computedBill: number }>, in4Docs: ReportDoc[]): SupplierComparison {
  const hub = new Map(hubDocs.map(d => [d.projectName, d.computedBill]))
  const in4 = new Map(in4Docs.map(d => [d.projectName, d.computedBill]))
  const rows: SupplierComparison['rows'] = []
  for (const name of new Set([...hub.keys(), ...in4.keys()])) {
    const h = hub.get(name) ?? null, i = in4.get(name) ?? null
    let verdict: ReportComparisonRow['verdict']
    if (h == null) verdict = 'in4-only'
    else if (i == null) verdict = 'hub-only'
    else { const d = Math.abs(h - i); verdict = d <= 1 ? 'exact' : d <= Math.max(Math.abs(h), Math.abs(i)) * 0.005 ? 'near' : 'off' }
    rows.push({ project: name, hub: h, in4: i, verdict })
  }
  rows.sort((a, b) => (b.in4 ?? b.hub ?? 0) - (a.in4 ?? a.hub ?? 0))
  const uploadAt = hubDocs.map(d => d.uploadedAt ?? '').filter(Boolean).sort().pop() ?? null
  return {
    comparedAt: new Date().toISOString(), uploadAt, rows,
    totals: { exact: rows.filter(r => r.verdict === 'exact').length, near: rows.filter(r => r.verdict === 'near').length, off: rows.filter(r => !['exact', 'near'].includes(r.verdict)).length },
  }
}
