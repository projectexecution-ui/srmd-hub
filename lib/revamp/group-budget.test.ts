import { describe, it, expect } from 'vitest'
import { rollupGroupTotal, type GroupChild } from './group-budget'

const child = (over: Partial<GroupChild['money']> & { builtUpSft?: number | null }): GroupChild => ({
  id: crypto.randomUUID(), code: null, chip: null, name: 'x', ccStatus: 'active',
  builtUpSft: over.builtUpSft ?? null, setupPct: 0,
  money: {
    internalEstimate: over.internalEstimate ?? 0,
    awaitingApproval: over.awaitingApproval ?? 0,
    budgetErp: over.budgetErp ?? 0,
    wo: over.wo ?? 0,
    paid: over.paid ?? 0,
    usedPct: over.usedPct ?? null,
    awaitingCount: over.awaitingCount ?? 0,
  },
})

describe('rollupGroupTotal', () => {
  it('sums each figure across the children', () => {
    const t = rollupGroupTotal([
      child({ internalEstimate: 100, budgetErp: 80, wo: 40, paid: 20, awaitingApproval: 10, awaitingCount: 1 }),
      child({ internalEstimate: 300, budgetErp: 120, wo: 60, paid: 30, awaitingApproval: 5, awaitingCount: 2 }),
    ])
    expect(t.internalEstimate).toBe(400)
    expect(t.budgetErp).toBe(200)
    expect(t.wo).toBe(100)
    expect(t.paid).toBe(50)
    expect(t.awaitingApproval).toBe(15)
    expect(t.awaitingCount).toBe(3)
  })

  it('derives % used from the summed paid ÷ summed ERP budget, not by averaging child %s', () => {
    const t = rollupGroupTotal([
      child({ budgetErp: 100, paid: 100, usedPct: 100 }), // fully used
      child({ budgetErp: 100, paid: 0, usedPct: 0 }),     // untouched
    ])
    expect(t.usedPct).toBe(50) // 100 paid ÷ 200 budget, NOT (100+0)/2 by luck
  })

  it('% used is null when the group has no ERP budget to divide by', () => {
    expect(rollupGroupTotal([child({ paid: 5 })]).usedPct).toBeNull()
  })

  it('area is the sum where set, and null when no child has one', () => {
    expect(rollupGroupTotal([child({ builtUpSft: 1000 }), child({ builtUpSft: 500 })]).builtUpSft).toBe(1500)
    expect(rollupGroupTotal([child({}), child({})]).builtUpSft).toBeNull()
  })

  it('an empty group is all zeros, area and % null', () => {
    const t = rollupGroupTotal([])
    expect(t.budgetErp).toBe(0)
    expect(t.usedPct).toBeNull()
    expect(t.builtUpSft).toBeNull()
  })
})
