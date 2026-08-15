import { describe, it, expect } from 'vitest'
import { composeBudgetV2 } from './budget-v2'
import { buildBudgetV2Report } from './budget-v2-report'

const NOW = Date.parse('2026-08-13T00:00:00Z')
const fresh = { budget: '2026-08-12T00:00:00Z' }

const budget = [
  { id: 'g1', type: 'group', name: 'NGH', parentId: null },
  {
    id: 'p1', type: 'individual', name: 'NGH A', parentId: 'g1',
    areaStatement: { builtUp: 100 },
    data: { rows: [{ head: '001 Civil', catNum: '001', budget: 1000, woApproved: 900, actual: 600 }], subRows: [] },
  },
  {
    id: 'p2', type: 'individual', name: 'NGH B', parentId: 'g1',
    areaStatement: { builtUp: 100 },
    data: { rows: [{ head: '001 Civil', catNum: '001', budget: 500, woApproved: 500, actual: 550 }], subRows: [] },
  },
  // Placeholder-only project: no numbers → must be dropped from the card.
  { id: 'p3', type: 'individual', name: 'NGH Empty', parentId: 'g1', data: { rows: [], subRows: [] } },
]

describe('buildBudgetV2Report', () => {
  it('builds a grouped Group → Project card with Budget / Paid / Balance', () => {
    const result = composeBudgetV2(budget, { 'NGH B': 'closed' })
    const rep = buildBudgetV2Report(result, fresh, NOW)!
    expect(rep).not.toBeNull()

    // Header stats: total budget 1500, paid 1150 = 77%.
    expect(rep.title).toBe('Budget vs Actual — 2 projects')
    expect(rep.cardSpec.stats![0].value).toBe('₹1,500/-')
    expect(rep.cardSpec.stats![1].label).toContain('77%')

    // One section for the NGH group, empty placeholder project excluded.
    const sec = rep.cardSpec.sections![0]
    expect(sec.heading).toBe('NGH · 2 projects')
    expect(sec.rows!.map(r => r.main)).toEqual(['NGH A', 'NGH B · closed'])

    // Row detail carries Budget + Paid + Balance + ₹/sft; overspent row is danger-toned.
    expect(sec.rows![0].sub).toContain('Budget ₹1,000/-')
    expect(sec.rows![0].sub).toContain('Paid ₹600/-')
    expect(sec.rows![0].sub).toContain('Bal ₹400/-')
    expect(sec.rows![0].sub).toContain('₹6/sft')
    expect(sec.rows![0].right).toBe('60%')
    expect(sec.rows![1].right).toBe('110%')
    expect(sec.rows![1].rightTone).toBe('danger')
  })

  it('warns when the budget report is 14+ days old', () => {
    const result = composeBudgetV2(budget, {})
    const stale = { budget: '2026-07-01T00:00:00Z' }
    const rep = buildBudgetV2Report(result, stale, NOW)!
    expect(rep.cardSpec.sections![0].banner?.tone).toBe('warn')
    expect(rep.cardSpec.sections![0].banner?.text).toContain('budget')
  })

  it('returns null when nothing carries budget/spend', () => {
    const emptyOnly = [
      { id: 'g1', type: 'group', name: 'NGH', parentId: null },
      { id: 'p3', type: 'individual', name: 'NGH Empty', parentId: 'g1', data: { rows: [], subRows: [] } },
    ]
    const result = composeBudgetV2(emptyOnly, {})
    expect(buildBudgetV2Report(result, fresh, NOW)).toBeNull()
  })
})
