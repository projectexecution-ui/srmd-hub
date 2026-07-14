import { describe, it, expect } from 'vitest'
import { mapBudgetToWS } from './ib-reimport'
import type { InternalBudget } from './internal-budget-parse'

// Minimal masters: 302 Steel (disc 03), 305 Masonry (disc 03). No 399 yet.
const masterSubDisc = new Map<string, string>([['302', '03'], ['305', '03']])
const masterDiscs = new Set(['03', '16'])

function budget(disciplines: InternalBudget['disciplines']): InternalBudget {
  return {
    sheetName: 'x', areaSft: 1000, grandTotal: 0, grandTotalSource: 'sum',
    moneySource: 'internal_estimated', disciplines, skipped: [], itemSum: 0,
    parseOk: true, failReason: null,
  }
}

describe('mapBudgetToWS', () => {
  it('coded sub-skills map to their master code; unknown ones go to the discipline bucket', () => {
    const b = budget([
      { code: '03', name: 'Civil', categoryTotal: null, reconDelta: null, subSkills: [
        { code: '302', name: 'Steel Works', amount: 100, remark: 'as per WO', working: null, workingSheetName: null },
        { code: null, name: 'Fancy Cladding', amount: 40, remark: null, working: null, workingSheetName: null },
      ] },
    ])
    const plan = mapBudgetToWS(b, masterSubDisc, masterDiscs)
    const steel = plan.rows.find(r => r.subCode === '302')!
    expect(steel.amount).toBe(100)
    expect(steel.remark).toBe('as per WO')
    const bucket = plan.rows.find(r => r.subCode === '399')!
    expect(bucket.amount).toBe(40)
    expect(plan.bucketDiscs).toContain('03')
    expect(plan.total).toBe(140)
  })

  it('a prose section with no code derives its discipline from a coded child', () => {
    const b = budget([
      { code: null, name: 'Some Section', categoryTotal: null, reconDelta: null, subSkills: [
        { code: '305', name: 'Masonry', amount: 50, remark: null, working: null, workingSheetName: null },
      ] },
    ])
    const plan = mapBudgetToWS(b, masterSubDisc, masterDiscs)
    // parser normally sets d.code; here d.code null but 305 is a known master.
    expect(plan.rows.find(r => r.subCode === '305')?.amount).toBe(50)
    expect(plan.unplaced).toHaveLength(0)
  })

  it('zero-amount lines are dropped; truly unmappable lines are reported', () => {
    const b = budget([
      { code: '99', name: 'Ghost', categoryTotal: null, reconDelta: null, subSkills: [
        { code: null, name: 'No discipline', amount: 10, remark: null, working: null, workingSheetName: null },
        { code: '302', name: 'Steel', amount: 0, remark: null, working: null, workingSheetName: null },
      ] },
    ])
    const plan = mapBudgetToWS(b, masterSubDisc, masterDiscs)
    expect(plan.total).toBe(0)
    expect(plan.unplaced.some(u => u.name === 'No discipline')).toBe(true)
  })
})
