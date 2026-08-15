import { describe, it, expect } from 'vitest'
import { composeBudgetV2, snapshotOf, deltaVs } from './budget-v2'

const budget = [
  { id: 'g1', type: 'group', name: 'NGH', parentId: null },
  {
    id: 'p1', type: 'individual', name: 'NGH A', parentId: 'g1',
    areaStatement: { builtUp: 57000 },
    data: {
      rows: [{ head: '001 Civil', catNum: '001', budget: 1000, woApproved: 900, actual: 1100 }],
      subRows: [{ head: '101 RCC', catNum: '01', subNum: '101', budget: 600, woApproved: 550, actual: 650 }],
    },
  },
  { id: 'p2', type: 'individual', name: 'NGH C', parentId: 'g1', areaStatement: { builtUp: 80000 }, data: { rows: [{ head: '001 Civil', catNum: '001', budget: 500, woApproved: 500, actual: 480 }], subRows: [] } },
  { id: 'p3', type: 'individual', name: 'Admin Block', parentId: null, areaStatement: { builtUp: 10000 }, data: { rows: [{ head: '001 Civil', catNum: '001', budget: 200, woApproved: 150, actual: 100 }], subRows: [] } },
]

describe('composeBudgetV2', () => {
  it('builds Group → Project → Category → Sub-Category from the budget report', () => {
    const r = composeBudgetV2(budget, {})
    const a = r.groups.find(g => g.name === 'NGH')!.projects.find(p => p.name === 'NGH A')!
    expect(a.group).toBe('NGH')
    expect(a.budget).toBe(1000); expect(a.spent).toBe(1100); expect(a.area).toBe(57000)
    expect(a.categories[0].subcats[0].label).toBe('RCC')
  })

  it('carries WO/PO Approved (woApproved) up the tree', () => {
    const r = composeBudgetV2(budget, {})
    const a = r.groups.find(g => g.name === 'NGH')!.projects.find(p => p.name === 'NGH A')!
    expect(a.approved).toBe(900)
    expect(a.categories[0].approved).toBe(900)
    expect(a.categories[0].subcats[0].approved).toBe(550)
    // Portfolio total approved = 900 + 500 + 150 = 1550
    expect(r.totals.approved).toBe(1550)
  })

  it('Paid comes straight from the budget report actual column (no overlay)', () => {
    const r = composeBudgetV2(budget, {})
    // spent = sum of actuals; totals stay exact from the budget report alone.
    expect(r.totals.budget).toBe(1000 + 500 + 200)
    expect(r.totals.spent).toBe(1100 + 480 + 100)
  })

  it('sorts groups alpha (Ungrouped last); open before closed', () => {
    const r = composeBudgetV2(budget, { 'NGH A': 'open', 'NGH C': 'closed' })
    expect(r.groups.map(g => g.name)).toEqual(['NGH', '— Ungrouped'])
    expect(r.groups[0].projects.map(p => p.name)).toEqual(['NGH A', 'NGH C'])
  })

  it('honours V2 area override (beats budget_hub_state.areaStatement.builtUp)', () => {
    const r = composeBudgetV2(budget, {}, { 'NGH A': 99999 })
    const a = r.groups.find(g => g.name === 'NGH')!.projects.find(p => p.name === 'NGH A')!
    expect(a.area).toBe(99999)
  })

  it('injects V2 EXTRA projects into the tree with empty budgets', () => {
    const r = composeBudgetV2(budget, {}, {}, [
      { name: 'NGH D', group_name: 'NGH', area_sft: 50000 },
      { name: 'Future Block', group_name: null, area_sft: 12000 },
    ])
    const ngh = r.groups.find(g => g.name === 'NGH')!
    expect(ngh.projects.some(p => p.name === 'NGH D' && p.area === 50000 && p.budget === 0)).toBe(true)
    const standalone = r.groups.find(g => g.name === '— Ungrouped')!
    expect(standalone.projects.some(p => p.name === 'Future Block')).toBe(true)
  })

  it('does not duplicate when an extra project name collides with a BPH project', () => {
    const r = composeBudgetV2(budget, {}, {}, [
      { name: 'NGH A', group_name: 'NGH', area_sft: 11111 }, // BPH already has NGH A
    ])
    const a = r.groups.find(g => g.name === 'NGH')!.projects.filter(p => p.name === 'NGH A')
    expect(a).toHaveLength(1)
    expect(a[0].area).toBe(57000) // BPH area wins (no override given)
  })

  it('merges IN4 "(A)" variant lines under one clean category by LABEL', () => {
    const b = [{
      id: 'p9', type: 'individual', name: 'NGH A', parentId: null,
      areaStatement: { builtUp: 1000 },
      data: {
        rows: [
          { head: '001 (A) Site Pre-lims', catNum: '001', budget: 52000, woApproved: 52000, actual: 52000 },
          { head: '01 Site Pre-lims', catNum: '01', budget: 236739, woApproved: 230000, actual: 228284 },
        ],
        subRows: [{ head: '109 Utility Disconnection', catNum: '01', subNum: '109', budget: 236739, woApproved: 230000, actual: 228284 }],
      },
    }]
    const r = composeBudgetV2(b, {})
    const cats = r.groups[0].projects[0].categories
    expect(cats).toHaveLength(1) // ← merged: was 2 before
    const c = cats[0]
    expect(c.label).toBe('Site Pre-lims') // ← uses the cleanest label, no "(A)"
    expect(c.budget).toBe(52000 + 236739)
    expect(c.approved).toBe(52000 + 230000)
    expect(c.spent).toBe(52000 + 228284)
    expect(c.subcats).toHaveLength(1)
  })

  it('applies a flagged override to an uploaded project and keeps the uploaded value', () => {
    const r = composeBudgetV2(budget, {}, {}, [], { 'NGH A': { budget: null, approved: null, paid: 5000, note: 'advance corrected' } })
    const a = r.groups.find(g => g.name === 'NGH')!.projects.find(p => p.name === 'NGH A')!
    expect(a.spent).toBe(5000)              // overridden
    expect(a.manual?.spent).toBe(true)
    expect(a.uploaded?.spent).toBe(1100)    // original kept underneath
    expect(a.budget).toBe(1000)             // untouched (override was null)
    expect(a.manualNote).toBe('advance corrected')
    // group total reflects the override
    expect(r.groups.find(g => g.name === 'NGH')!.spent).toBe(5000 + 480)
  })

  it('hand-added extra project carries numbers and is flagged manual', () => {
    const r = composeBudgetV2(budget, {}, {}, [
      { name: 'Raj Uphaar', group_name: 'RU', budget: 1015228556, approved: 947935345, paid: 821629857 },
    ])
    const ru = r.groups.find(g => g.name === 'RU')!.projects.find(p => p.name === 'Raj Uphaar')!
    expect(ru.budget).toBe(1015228556)
    expect(ru.spent).toBe(821629857)
    expect(ru.isExtra).toBe(true)
    expect(ru.manual?.budget).toBe(true)
    // portfolio total now includes RU's paid
    expect(r.totals.spent).toBe(1100 + 480 + 100 + 821629857)
  })

  it('snapshotOf + deltaVs compute week-over-week paid movement', () => {
    const r = composeBudgetV2(budget, {})
    const snap = snapshotOf(r)
    // no baseline → zero deltas
    expect(deltaVs(r, null).hasBaseline).toBe(false)
    // fabricate last week where NGH A paid was 1000 (now 1100) → +100
    const prev = { ...snap, projects: { ...snap.projects, 'NGH A': { budget: 1000, approved: 900, spent: 1000 } },
      overall: { budget: snap.overall.budget, approved: snap.overall.approved, spent: snap.overall.spent - 100 } }
    const d = deltaVs(r, prev)
    expect(d.hasBaseline).toBe(true)
    expect(d.byProject['NGH A'].paid).toBe(100)
    expect(d.overall.paid).toBe(100)
  })

  it('does NOT merge same-code categories with different labels (SRAH case)', () => {
    // SRAH has both "001 (A) Site Pre-lims" and "01 Pre Design Works" sharing
    // base code 1 — they are GENUINELY different categories and must stay split.
    const b = [{
      id: 'p9', type: 'individual', name: 'SRAH', parentId: null,
      areaStatement: { builtUp: 1000 },
      data: {
        rows: [
          { head: '001 (A) Site Pre-lims', catNum: '001', budget: 52000, woApproved: 52000, actual: 52000 },
          { head: '01 Pre Design Works', catNum: '01', budget: 100000, woApproved: 90000, actual: 80000 },
        ],
        subRows: [],
      },
    }]
    const r = composeBudgetV2(b, {})
    expect(r.groups[0].projects[0].categories).toHaveLength(2)
    expect(r.groups[0].projects[0].categories.map(c => c.label).sort())
      .toEqual(['Pre Design Works', 'Site Pre-lims'])
  })
})
