import { describe, it, expect } from 'vitest'
import { planNotices, EMPTY_STATE } from './approvals-watch'

describe('planNotices — work orders (Aksha, 10 Sep 2026)', () => {
  const wo = {
    kind: 'wo' as const, id: 1842, ref: 'WO/SRJT/SRAH/2026-27/4', statusId: 113, status: 'Verify', subprojectId: 31, projectId: 9,
    who: 'Rahul Patel', since: '2026-04-15T14:52:09.000Z', what: 'SANDEEP KUMAR', value: 424750, context: 'Civil · Repairs at SRAH',
  }
  it('announces a WO at Verify once, with the contractor and the value', () => {
    const first = planNotices(EMPTY_STATE, [wo], [], '2026-09-10T04:00:00.000Z')
    expect(first.notices.map(x => x.type)).toEqual(['in4_wo_verify'])
    expect(first.notices[0].title).toBe('WO WO/SRJT/SRAH/2026-27/4 is waiting for your approval in IN4')
    expect(first.notices[0].body).toContain('SANDEEP KUMAR')
    expect(first.notices[0].body).toContain('₹4,24,750')
    expect(first.next.wos).toEqual({ '1842': 113 })
    expect(planNotices(first.next, [wo], [], '2026-09-10T16:00:00.000Z').notices).toEqual([])
  })
  it('is silent at Submitted — that is the verifier’s turn, not the Atm Head’s', () => {
    expect(planNotices(EMPTY_STATE, [{ ...wo, statusId: 1, status: 'Submitted' }], [], '2026-09-10T04:00:00.000Z').notices).toEqual([])
  })
  it('an old memory without a wos book still works', () => {
    const legacy = { indents: {}, pos: {}, grnSince: '2026-09-01', grns: {}, lastRunAt: null }
    expect(planNotices(legacy, [wo], [], '2026-09-10T04:00:00.000Z').notices).toHaveLength(1)
  })
})
