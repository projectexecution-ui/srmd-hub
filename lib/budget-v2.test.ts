import { describe, it, expect } from 'vitest'
import { composeBudgetV2, normName, type AliasRow } from './budget-v2'

const budget = [
  { id: 'g1', type: 'group', name: 'NGH', parentId: null },
  {
    id: 'p1', type: 'individual', name: 'NGH A', parentId: 'g1',
    areaStatement: { builtUp: 57000 },
    data: {
      rows: [{ head: '001 Civil', catNum: '001', budget: 1000, actual: 1100 }],
      subRows: [{ head: '101 RCC', catNum: '01', subNum: '101', budget: 600, actual: 650 }],
    },
  },
  {
    id: 'p2', type: 'individual', name: 'NGH C', parentId: 'g1',
    areaStatement: { builtUp: 80000 },
    data: { rows: [{ head: '001 Civil', catNum: '001', budget: 500, actual: 480 }], subRows: [] },
  },
  {
    id: 'p3', type: 'individual', name: 'Admin Block', parentId: null,
    areaStatement: { builtUp: 10000 },
    data: { rows: [{ head: '001 Civil', catNum: '001', budget: 200, actual: 100 }], subRows: [] },
  },
]

const contractor = [{
  projectName: 'New Guest House',
  subprojects: [{
    name: 'New Guest House A-Execution',
    categories: [{ category: ' 001 Civil', contractors: [{ contractor: 'Tandon', woValue: 900, billValue: 850, paidValue: 800, outstanding: 50 }] }],
  }],
}]

const supplier = [{
  projectName: 'Admin Block',
  subprojects: [{
    name: 'Admin Block - Execution',
    categories: [{ category: '001 Civil', suppliers: [{ supplier: 'Shree', billValue: 120, paidValue: 100, outstanding: 20 }] }],
  }],
}]

describe('composeBudgetV2', () => {
  it('builds the budget tree: group → project → category → sub-category', () => {
    const r = composeBudgetV2(budget, [], [], [], {})
    const ngh = r.groups.find(g => g.name === 'NGH')!
    expect(ngh).toBeTruthy()
    const a = ngh.projects.find(p => p.name === 'NGH A')!
    expect(a.budget).toBe(1000)
    expect(a.spent).toBe(1100)
    expect(a.area).toBe(57000)
    expect(a.categories[0].subcats[0].label).toBe('RCC')
  })

  it('sorts groups alphabetically with Ungrouped last; open projects before closed', () => {
    const r = composeBudgetV2(budget, [], [], [], { 'NGH A': 'open', 'NGH C': 'closed' })
    expect(r.groups.map(g => g.name)).toEqual(['NGH', '— Ungrouped'])
    const ngh = r.groups[0]
    expect(ngh.projects.map(p => p.name)).toEqual(['NGH A', 'NGH C']) // open (A) before closed (C)
    expect(ngh.projects[1].status).toBe('closed')
  })

  it('attaches payments via a confirmed alias (NGH A) and rolls up outstanding', () => {
    const aliases: AliasRow[] = [{ source: 'contractor', payment_name: 'New Guest House A-Execution', budget_project: 'NGH A', confirmed: true }]
    const r = composeBudgetV2(budget, contractor, [], aliases, {})
    const a = r.groups[0].projects.find(p => p.name === 'NGH A')!
    const civil = a.categories.find(c => c.code === '001' || c.label === 'Civil')!
    expect(civil.parties).toHaveLength(1)
    expect(civil.parties[0].name).toBe('Tandon')
    expect(a.outstanding).toBe(50)
    expect(r.unmatched).toHaveLength(0)
  })

  it('falls back to exact normalised name match (Admin Block) with no alias', () => {
    const r = composeBudgetV2(budget, [], supplier, [], {})
    const admin = r.groups.find(g => g.name === '— Ungrouped')!.projects.find(p => p.name === 'Admin Block')!
    expect(admin.categories.some(c => c.parties.some(p => p.name === 'Shree'))).toBe(true)
    expect(admin.outstanding).toBe(20)
  })

  it('surfaces unmatched payments instead of dropping them', () => {
    const r = composeBudgetV2(budget, contractor, [], [], {}) // no alias, name does not match
    expect(r.unmatched).toHaveLength(1)
    expect(r.unmatched[0].paymentName).toBe('New Guest House A-Execution')
    expect(r.unmatched[0].paid).toBe(800)
  })

  it('respects an explicit "ignore" alias (budget_project=null)', () => {
    const aliases: AliasRow[] = [{ source: 'contractor', payment_name: 'New Guest House A-Execution', budget_project: null, confirmed: true }]
    const r = composeBudgetV2(budget, contractor, [], aliases, {})
    expect(r.unmatched).toHaveLength(0) // ignored, not surfaced
  })

  it('normName strips phase suffixes', () => {
    expect(normName('Admin Block - Execution')).toBe('admin block')
    expect(normName('Vinay Vivek - Professional Consultancy')).toBe('vinay vivek')
  })
})
