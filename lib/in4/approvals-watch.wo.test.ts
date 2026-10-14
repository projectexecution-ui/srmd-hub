import { describe, it, expect } from 'vitest'
import { planNotices, EMPTY_STATE } from './approvals-watch'

describe('planNotices — work orders', () => {
  const wo = {
    kind: 'wo' as const, id: 1842, ref: 'WO/SRJT/SRAH/2026-27/4', statusId: 113, status: 'Verify', subprojectId: 31, projectId: 9,
    who: 'Rahul Patel', since: '2026-04-15T14:52:09.000Z', what: 'SANDEEP KUMAR', value: 424750, context: 'Civil · Repairs at SRAH',
  }
  it('does not announce a WO at Verify — Subhash approves those in IN4, not the Atm Head (Aksha, 14 Oct 2026)', () => {
    const first = planNotices(EMPTY_STATE, [wo], [], '2026-10-14T04:00:00.000Z')
    expect(first.notices).toEqual([])
  })
  it('still remembers it, so switching WOs back on would not replay a backlog', () => {
    const first = planNotices(EMPTY_STATE, [wo], [], '2026-10-14T04:00:00.000Z')
    expect(first.next.wos).toEqual({ '1842': 113 })
  })
  it('an old memory without a wos book still works', () => {
    const legacy = { indents: {}, pos: {}, grnSince: '2026-09-01', grns: {}, lastRunAt: null }
    expect(planNotices(legacy, [wo], [], '2026-10-14T04:00:00.000Z').next.wos).toEqual({ '1842': 113 })
  })
})
