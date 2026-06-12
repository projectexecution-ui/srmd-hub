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
  { id: 'p2', type: 'individual', name: 'NGH C', parentId: 'g1', areaStatement: { builtUp: 80000 }, data: { rows: [{ head: '001 Civil', catNum: '001', budget: 500, actual: 480 }], subRows: [] } },
  { id: 'p3', type: 'individual', name: 'Admin Block', parentId: null, areaStatement: { builtUp: 10000 }, data: { rows: [{ head: '001 Civil', catNum: '001', budget: 200, actual: 100 }], subRows: [] } },
]

const contractorBlock = [{
  projectName: 'New Guest House',
  subprojects: [{ name: 'New Guest House A-Execution', categories: [{ category: ' 001 Civil', contractors: [{ contractor: 'Tandon', woValue: 900, billValue: 850, paidValue: 800, outstanding: 50 }] }] }],
}]
const supplierAdmin = [{
  projectName: 'Admin Block',
  subprojects: [{ name: 'Admin Block - Execution', categories: [{ category: '001 Civil', suppliers: [{ supplier: 'Shree', billValue: 120, paidValue: 100, outstanding: 20 }] }] }],
}]

describe('composeBudgetV2', () => {
  it('builds Group → Project → Category → Sub-Category from budget', () => {
    const r = composeBudgetV2(budget, [], [], [], {})
    const a = r.groups.find(g => g.name === 'NGH')!.projects.find(p => p.name === 'NGH A')!
    expect(a.group).toBe('NGH')
    expect(a.budget).toBe(1000); expect(a.spent).toBe(1100); expect(a.area).toBe(57000)
    expect(a.categories[0].subcats[0].label).toBe('RCC')
  })

  it('sorts groups alpha (Ungrouped last); open before closed', () => {
    const r = composeBudgetV2(budget, [], [], [], { 'NGH A': 'open', 'NGH C': 'closed' })
    expect(r.groups.map(g => g.name)).toEqual(['NGH', '— Ungrouped'])
    expect(r.groups[0].projects.map(p => p.name)).toEqual(['NGH A', 'NGH C'])
  })

  it('PROJECT-level alias to a GROUP auto-resolves the block (New Guest House → NGH, A → NGH A)', () => {
    const aliases: AliasRow[] = [{ source: 'contractor', payment_name: 'New Guest House', budget_project: 'NGH', confirmed: true }]
    const r = composeBudgetV2(budget, contractorBlock, [], aliases, {})
    const a = r.groups[0].projects.find(p => p.name === 'NGH A')!
    expect(a.categories.some(c => c.parties.some(p => p.name === 'Tandon'))).toBe(true)
    expect(a.outstanding).toBe(50)
    expect(r.unmatchedProjects).toHaveLength(0)
    expect(r.unmatchedLines).toHaveLength(0)
  })

  it('exact normalised name fallback still works (Admin Block) with no alias', () => {
    const r = composeBudgetV2(budget, [], supplierAdmin, [], {})
    const admin = r.groups.find(g => g.name === '— Ungrouped')!.projects.find(p => p.name === 'Admin Block')!
    expect(admin.categories.some(c => c.parties.some(p => p.name === 'Shree'))).toBe(true)
  })

  it('surfaces an unmatched PROJECT (once) when nothing matches', () => {
    const r = composeBudgetV2(budget, contractorBlock, [], [], {})
    expect(r.unmatchedProjects).toHaveLength(1)
    expect(r.unmatchedProjects[0].projectName).toBe('New Guest House')
    expect(r.unmatchedProjects[0].paid).toBe(800)
  })

  it('surfaces an ambiguous LINE when a group-mapped sub-project has no block token', () => {
    const ambig = [{ projectName: 'New Guest House', subprojects: [{ name: 'New Guest House - Professional Consultancy', categories: [{ category: '001 Civil', contractors: [{ contractor: 'X', paidValue: 10, outstanding: 5 }] }] }] }]
    const aliases: AliasRow[] = [{ source: 'contractor', payment_name: 'New Guest House', budget_project: 'NGH', confirmed: true }]
    const r = composeBudgetV2(budget, ambig, [], aliases, {})
    expect(r.unmatchedLines).toHaveLength(1)
    expect(r.unmatchedLines[0].group).toBe('NGH')
  })

  it('respects an "ignore" alias (budget_project=null)', () => {
    const aliases: AliasRow[] = [{ source: 'contractor', payment_name: 'New Guest House', budget_project: null, confirmed: true }]
    const r = composeBudgetV2(budget, contractorBlock, [], aliases, {})
    expect(r.unmatchedProjects).toHaveLength(0)
    expect(r.unmatchedLines).toHaveLength(0)
  })

  it('normName strips phase suffixes', () => {
    expect(normName('Admin Block - Execution')).toBe('admin block')
  })
})
