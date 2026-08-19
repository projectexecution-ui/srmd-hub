import { describe, it, expect } from 'vitest'
import { buildApprovalCardSpec, type ApprovalCardInput } from './approval-card'

const base: ApprovalCardInput = {
  wsCode: 'NGHB-CIV-W3',
  project: { code: 'NGH B', name: 'New Guest House B' },
  work: 'RCC Superstructure',
  category: '01 Site Pre-lims',
  subCategory: '101 Soil',
  stage: 'submitted',
  amount: 4820000,
  area: 65400,
  raisedBy: 'Ramesh',
  daysWaiting: 3,
  overdue: false,
  erp: { budget: 17770000, wo: 10950000, paid: 8640000 },
  erpNew: false,
  revision: null,
  approvedSoFar: null,
  afterThis: null,
  showPerSft: true,
  showErp: true,
  nextActionLabel: 'Project Head sign-off',
}

describe('buildApprovalCardSpec', () => {
  it('builds the approval card with the ask + ERP position', () => {
    const c = buildApprovalCardSpec(base)
    expect(c.brand).toBe('Budget approval')
    // Project name is the hero; the ws code moves to the subtitle.
    expect(c.title).toBe('New Guest House B')
    expect(c.subtitle).toContain('NGHB-CIV-W3')
    // Category + Sub-category (with codes) are constant identity chips.
    expect(c.chips).toContain('Category · 01 Site Pre-lims')
    expect(c.chips).toContain('Sub-category · 101 Soil')
    // ask stat with ₹/sft + days
    expect(c.stats![0].value).toBe('₹48,20,000')
    expect(c.stats![0].sub).toContain('/sft')
    expect(c.stats![0].sub).toContain('waiting 3d')
    // ERP stat present (paid 8.64/17.77 ≈ 49%)
    expect(c.stats![1].label).toBe('Budget (ERP)')
    expect(c.stats![1].sub).toContain('49%')
    // stage chain marks the Project Head as acting now
    const appr = c.sections!.find(s => s.heading === 'Approval')!
    expect(appr.sub).toContain('» Project Head «')
  })

  it('hides ERP + ₹/sft when the viewer is not allowed them', () => {
    const c = buildApprovalCardSpec({ ...base, showErp: false, showPerSft: false })
    expect(c.stats!.every(s => s.label !== 'Budget (ERP)')).toBe(true)
    expect(c.sections!.every(s => s.heading !== 'ERP position')).toBe(true)
    expect(c.stats![0].sub).not.toContain('/sft')
  })

  it('shows the revision delta on a v2+ ask', () => {
    const c = buildApprovalCardSpec({ ...base, stage: 'ph_approved', revision: { n: 2, deltaPct: 12 }, nextActionLabel: 'Atm Head sign-off' })
    const the = c.sections!.find(s => s.heading === 'The budget')!
    expect(the.rows!.some(r => r.main === 'Revision 2' && r.right === '+12%')).toBe(true)
    expect(c.sections!.find(s => s.heading === 'Approval')!.sub).toContain('» Atm Head «')
  })
})
