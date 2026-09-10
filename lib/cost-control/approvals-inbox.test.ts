import { describe, it, expect } from 'vitest'
import {
  pickFirst, daysWaiting, increment, pendingValue, groupByProject, groupByDiscipline,
  type WSRow,
} from './approvals-inbox'

function ws(over: Partial<WSRow> & { id: string }): WSRow {
  return {
    ws_code: 'WS-' + over.id, status: 'submitted', total_amount: 0, approved_for_erp_amt: null,
    submitted_at: null, engineer_id: 'e', discipline_id: 'd', sub_skill_id: 's', project_id: 'p',
    chain_anchor_id: null, version_no: 1, entry_mode: null, summary_notes: null,
    projects: null, cc_disciplines: null, cc_sub_skills: null,
    ...over,
  } as WSRow
}

describe('increment — what a pending sheet ADDS once signed off', () => {
  it('is the ask minus what the chain already released', () => {
    expect(increment(ws({ id: '1', total_amount: 1_000_000, approved_for_erp_amt: 400_000 }))).toBe(600_000)
  })

  it('treats a never-approved sheet as adding its whole ask', () => {
    expect(increment(ws({ id: '1', total_amount: 250_000, approved_for_erp_amt: null }))).toBe(250_000)
  })

  it('NEVER goes negative — a sheet revised DOWN below what is already approved', () => {
    // Real case: v2 asks less than v1 already released. The card would
    // otherwise show "approved 10,00,000 → 8,00,000", i.e. approving a budget
    // appearing to REDUCE the approved figure.
    expect(increment(ws({ id: '1', total_amount: 800_000, approved_for_erp_amt: 1_000_000 }))).toBe(0)
  })

  it('sums across a list', () => {
    expect(pendingValue([
      ws({ id: '1', total_amount: 100, approved_for_erp_amt: 40 }),
      ws({ id: '2', total_amount: 500, approved_for_erp_amt: null }),
    ])).toBe(560)
  })
})

describe('daysWaiting', () => {
  it('is 0 for a sheet with no submission date, not NaN', () => {
    expect(daysWaiting(null)).toBe(0)
  })

  it('counts whole days since submission', () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 86400000 - 60_000).toISOString()
    expect(daysWaiting(fourDaysAgo)).toBe(4)
  })

  it('never goes negative on a clock skew into the future', () => {
    expect(daysWaiting(new Date(Date.now() + 86400000).toISOString())).toBe(0)
  })
})

describe('pickFirst — PostgREST returns an embed as object OR array', () => {
  it('unwraps both shapes and tolerates null', () => {
    expect(pickFirst({ code: 'A' })).toEqual({ code: 'A' })
    expect(pickFirst([{ code: 'A' }, { code: 'B' }])).toEqual({ code: 'A' })
    expect(pickFirst(null)).toBeNull()
    expect(pickFirst([])).toBeNull()
  })
})

describe('groupByProject', () => {
  it('orders projects by pending value, biggest first', () => {
    const rows = [
      ws({ id: 'a', project_id: 'small', total_amount: 100 }),
      ws({ id: 'b', project_id: 'big', total_amount: 900 }),
      ws({ id: 'c', project_id: 'small', total_amount: 100 }),
    ]
    const { byProject, projOrder } = groupByProject(rows)
    expect(projOrder).toEqual(['big', 'small'])
    expect(byProject.get('small')!.map(r => r.id)).toEqual(['a', 'c'])
  })

  it('ranks on the increment, not the raw ask', () => {
    // 'headline' asks more but has almost all of it approved already, so it
    // adds less money than 'real' and must rank below it.
    const rows = [
      ws({ id: 'a', project_id: 'headline', total_amount: 10_000, approved_for_erp_amt: 9_800 }),
      ws({ id: 'b', project_id: 'real', total_amount: 5_000, approved_for_erp_amt: 0 }),
    ]
    expect(groupByProject(rows).projOrder).toEqual(['real', 'headline'])
  })

  it('is empty for no rows', () => {
    expect(groupByProject([]).projOrder).toEqual([])
  })
})

describe('groupByDiscipline', () => {
  it('keeps arrival order, which is oldest submission first', () => {
    const rows = [
      ws({ id: 'a', discipline_id: 'civil' }),
      ws({ id: 'b', discipline_id: 'mep' }),
      ws({ id: 'c', discipline_id: 'civil' }),
    ]
    const { byDisc, discOrder } = groupByDiscipline(rows)
    expect(discOrder).toEqual(['civil', 'mep'])
    expect(byDisc.get('civil')!.map(r => r.id)).toEqual(['a', 'c'])
    expect(byDisc.get('mep')!.map(r => r.id)).toEqual(['b'])
  })
})
