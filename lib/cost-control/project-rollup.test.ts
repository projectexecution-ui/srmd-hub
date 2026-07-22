import { describe, it, expect } from 'vitest'
import { computeMoneyRollup, subFigures, type RollupWSRow, type RollupVersionRow, type RollupBudgetLine } from './project-rollup'

const D = 'disc-1'
const S1 = 'sub-1'
const S2 = 'sub-2'

const ws = (o: Partial<RollupWSRow> & { id: string; status: string }): RollupWSRow => ({
  discipline_id: D, sub_skill_id: S1, total_amount: 0, approved_for_erp_amt: 0, summary_notes: null, ...o,
})
const ver = (id: string, anchor: string, v: number): RollupVersionRow => ({ id, chain_anchor_id: anchor, version_no: v })

describe('computeMoneyRollup — baseline vs engineer', () => {
  it('keeps [IB] baseline as Internal Estimate and engineer ask as Awaiting, never mixed', () => {
    const wsRows = [
      ws({ id: 'ib', status: 'approved', total_amount: 1_000_000, summary_notes: '[IB] baseline' }),
      ws({ id: 'eng', status: 'submitted', total_amount: 1_200_000 }),
    ]
    const versionRows = [ver('ib', 'ib', 1), ver('eng', 'eng', 1)]
    const r = computeMoneyRollup({ wsRows, versionRows, budgetLines: [], subSkills: [{ id: S1, discipline_id: D }], disciplines: [{ id: D }] })
    const f = subFigures(r, D, S1)
    expect(f.internalEstimate).toBe(1_000_000)  // [IB] only
    expect(f.awaitingApproval).toBe(1_200_000)  // engineer ask only
    expect(f.wsCount).toBe(2)                    // two chains
    expect(r.discAgg.get(D)?.estimate).toBe(1_000_000)
    expect(r.discAgg.get(D)?.pending).toBe(1_200_000)
  })

  it('collapses a revision chain to its latest version (no double-count)', () => {
    const wsRows = [
      ws({ id: 'v1', status: 'submitted', total_amount: 500_000 }),
      ws({ id: 'v2', status: 'submitted', total_amount: 800_000 }),
    ]
    const versionRows = [ver('v1', 'v1', 1), ver('v2', 'v1', 2)] // same chain anchor v1
    const r = computeMoneyRollup({ wsRows, versionRows, budgetLines: [], subSkills: [{ id: S1, discipline_id: D }], disciplines: [{ id: D }] })
    expect(subFigures(r, D, S1).awaitingApproval).toBe(800_000) // v2 only, not 1.3M
    expect(subFigures(r, D, S1).wsCount).toBe(1)
  })

  it('splits a partially-approved sheet into released (approved) + balance (pending)', () => {
    const wsRows = [ws({ id: 'p', status: 'partially_approved', total_amount: 1_000_000, approved_for_erp_amt: 400_000 })]
    const r = computeMoneyRollup({ wsRows, versionRows: [ver('p', 'p', 1)], budgetLines: [], subSkills: [{ id: S1, discipline_id: D }], disciplines: [{ id: D }] })
    const f = subFigures(r, D, S1)
    expect(f.approvedViaWs).toBe(400_000)
    expect(f.awaitingApproval).toBe(600_000)
  })

  it('drops cancelled sheets entirely', () => {
    const wsRows = [ws({ id: 'x', status: 'cancelled', total_amount: 999 })]
    const r = computeMoneyRollup({ wsRows, versionRows: [ver('x', 'x', 1)], budgetLines: [], subSkills: [{ id: S1, discipline_id: D }], disciplines: [{ id: D }] })
    expect(subFigures(r, D, S1).awaitingApproval).toBe(0)
    expect(subFigures(r, D, S1).wsCount).toBe(0)
  })
})

describe('computeMoneyRollup — budget lines', () => {
  const bl = (o: Partial<RollupBudgetLine>): RollupBudgetLine => ({
    discipline_id: D, sub_skill_id: null, current_budget_amt: 0, current_wo_committed_amt: 0, current_paid_amt: 0, ...o,
  })

  it('sums budget/wo/paid across line_types for a sub-skill', () => {
    const budgetLines = [
      bl({ sub_skill_id: S1, current_budget_amt: 100, current_wo_committed_amt: 90, current_paid_amt: 80 }),
      bl({ sub_skill_id: S1, current_budget_amt: 50, current_wo_committed_amt: 40, current_paid_amt: 30 }),
    ]
    const r = computeMoneyRollup({ wsRows: [], versionRows: [], budgetLines, subSkills: [{ id: S1, discipline_id: D }], disciplines: [{ id: D }] })
    const f = subFigures(r, D, S1)
    expect(f.budget).toBe(150); expect(f.wo).toBe(130); expect(f.paid).toBe(110)
  })

  it('uses sub-skill lines and IGNORES the discipline-root line when both exist (no double-count)', () => {
    const budgetLines = [
      bl({ sub_skill_id: null, current_budget_amt: 1000 }),   // category summary row
      bl({ sub_skill_id: S1, current_budget_amt: 600 }),      // detail rows
      bl({ sub_skill_id: S2, current_budget_amt: 400 }),
    ]
    const r = computeMoneyRollup({ wsRows: [], versionRows: [], budgetLines, subSkills: [{ id: S1, discipline_id: D }, { id: S2, discipline_id: D }], disciplines: [{ id: D }] })
    expect(r.discAgg.get(D)?.budget).toBe(1000) // 600+400, root 1000 ignored
  })

  it('falls back to the discipline-root line when there are no sub-skill lines', () => {
    const budgetLines = [bl({ sub_skill_id: null, current_budget_amt: 1000, current_paid_amt: 250 })]
    const r = computeMoneyRollup({ wsRows: [], versionRows: [], budgetLines, subSkills: [{ id: S1, discipline_id: D }], disciplines: [{ id: D }] })
    expect(r.discAgg.get(D)?.budget).toBe(1000)
    expect(r.discAgg.get(D)?.paid).toBe(250)
  })
})
