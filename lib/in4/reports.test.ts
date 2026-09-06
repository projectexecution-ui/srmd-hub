import { describe, it, expect } from 'vitest'
import { buildContractorDocs, compareContractor, verdictTotals, type In4ContractorCert } from './contractor'
import { buildSupplierDocs, compareSupplier, type In4SupplierCert } from './supplier'

const names = {
  projectName: (id: number | null) => (id === 10 ? 'Warehouse' : 'Other'),
  subprojectName: (id: number) => (id === 40 ? 'Warehouse - Execution' : 'Warehouse - Design'),
  skillName: (id: number | null) => (id === 1 ? '03 Civil' : id === 7 ? '07 Electrical Works' : ''),
  contractorName: (id: number | null) => (id === 3 ? 'Desai Construction Pvt Ltd.' : id === 4 ? 'Amin' : ''),
  supplierName: (id: number | null) => (id === 8 ? 'Arihant' : ''),
}

const cert = (over: Partial<In4ContractorCert>): In4ContractorCert => ({
  kind: 'wo', certificate_id: 1, certificate_type_id: 3, certificate_type: 'Running', wo_id: 100, wo_no: 'WO/SRET/WH/2024-25/1', wo_value: 1_000_000,
  project_id: 10, subproject_id: 40, skill_id: 1, subskill_id: null, contractor_id: 3, status: 15,
  invoice_no: 'RA-1', invoice_date: '2025-01-10', creation_dt: '2025-01-12',
  gross: 118_000, recoveries: 10_000, paid: 100_000, deductions: 2_000, retention: 5_900, outstanding: 100, certified: 100_000, ...over,
})

describe('IN4 → contractor report', () => {
  it('groups project → sub-project → category → contractor and counts each WO once', () => {
    const docs = buildContractorDocs([
      cert({ certificate_id: 1 }),
      cert({ certificate_id: 2, gross: 50_000, recoveries: 0, paid: 50_000, deductions: 0, retention: 0, outstanding: 0 }),
      cert({ certificate_id: 3, kind: 'advance', certificate_type_id: 1, certificate_type: 'Advance', gross: 200_000, recoveries: 0, paid: 200_000, deductions: 0, retention: 0, outstanding: 0 }),
      cert({ certificate_id: 4, contractor_id: 4, skill_id: 7, wo_no: 'WO/SRET/WH/2024-25/2', wo_value: 300_000, gross: 30_000, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 30_000 }),
      cert({ certificate_id: 5, status: 6, gross: 9_999_999 }),   // cancelled — never in the export
    ], names, '2026-09-05T00:00:00Z')
    expect(docs).toHaveLength(1)
    const d = docs[0]
    expect(d.projectName).toBe('Warehouse')
    expect(d.subprojects).toHaveLength(1)
    const cats = d.subprojects[0].categories
    expect(cats.map(c => c.category)).toEqual(['03 Civil', '07 Electrical Works'])
    const desai = cats[0].contractors[0]
    expect(desai.contractor).toBe('Desai Construction Pvt Ltd.')
    expect(desai.woValue).toBe(1_000_000)          // three certificates, one WO
    expect(desai.billValue).toBe(118_000 - 10_000 + 50_000 + 200_000)
    expect(desai.paidValue).toBe(350_000)
    expect(desai.retentionHeld).toBe(5_900)
    expect(d.computed.grossBill).toBe(398_000)
    expect(d.computed.outstanding).toBe(30_100)
    expect(d.source).toBeNull()
  })

  it('compares the six figures per project with the stored upload', () => {
    const docs = buildContractorDocs([cert({})], names, '2026-09-05T00:00:00Z')
    const hub = [{ projectName: 'Warehouse', uploadedAt: '2026-09-03T04:20:40Z', computed: { grossBill: 118_000, recoveries: 10_000, paid: 100_000, deductions: 2_000, retention: 5_900, outstanding: 100 } }]
    const cmp = compareContractor(hub, docs)
    expect(cmp.rows[0].verdict).toBe('exact')
    expect(cmp.totals).toEqual({ exact: 1, near: 0, off: 0 })
    expect(verdictTotals({ grossBill: 100, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 }, { grossBill: 100.4, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 })).toBe('exact')
    expect(verdictTotals({ grossBill: 1000, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 }, { grossBill: 1003, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 })).toBe('near')
    expect(verdictTotals({ grossBill: 100, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 }, { grossBill: 150, recoveries: 0, paid: 0, deductions: 0, retention: 0, outstanding: 0 })).toBe('off')
  })
})

const sup = (over: Partial<In4SupplierCert>): In4SupplierCert => ({
  kind: 'payment', certificate_id: 1, certificate_no: '1001', project_id: 10, subproject_id: 40, supplier_id: 8, po_id: 5, status: 15,
  category: '07 (M) Electrical Works,08 (M) Plumbing Works',
  certified: 10_000, landed: 11_800, tax_add: 1_800, tax_ded: 0, adv_recovery: 1_000, debit_note: 0, retention: 500, payable: 10_300, paid: 10_300, outstanding: 0, ...over,
})

describe('IN4 → supplier report', () => {
  it('bill is the landed cost; advances file under (Uncategorised); cancelled are dropped', () => {
    const docs = buildSupplierDocs([
      sup({}),
      sup({ certificate_id: 2, kind: 'advance', category: null, certified: 5_000, landed: 5_000, tax_add: 0, adv_recovery: 0, retention: 0, payable: 5_000, paid: 5_000 }),
      sup({ certificate_id: 3, status: 6, landed: 9_999_999 }),
    ], names, '2026-09-05T00:00:00Z')
    expect(docs).toHaveLength(1)
    const cats = docs[0].subprojects[0].categories
    expect(cats.map(c => c.category)).toEqual(['(Uncategorised)', '07 (M) Electrical Works,08 (M) Plumbing Works'])
    expect(docs[0].computedBill).toBe(16_800)
    const s = cats[1].suppliers[0]
    expect(s.supplier).toBe('Arihant')
    expect(s.recoveries).toBe(1_000)
    expect(s.netPayable).toBe(10_300)
  })

  it('compares the bill per project with the stored upload', () => {
    const docs = buildSupplierDocs([sup({})], names, '2026-09-05T00:00:00Z')
    const cmp = compareSupplier([{ projectName: 'Warehouse', computedBill: 11_800 }, { projectName: 'Gone', computedBill: 5 }], docs)
    expect(cmp.rows.find(r => r.project === 'Warehouse')?.verdict).toBe('exact')
    expect(cmp.rows.find(r => r.project === 'Gone')?.verdict).toBe('hub-only')
  })
})
