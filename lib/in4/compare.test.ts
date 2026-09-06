import { describe, it, expect } from 'vitest'
import { compareProject, summarise, verdictFor } from './compare'

describe('verdictFor', () => {
  it('treats a rupee of Excel rounding as exact, half a percent as near', () => {
    expect(verdictFor(66_655_031, 66_655_030.85)).toBe('exact')
    expect(verdictFor(1_000_000, 1_004_000)).toBe('near')
    expect(verdictFor(1_000_000, 1_100_000)).toBe('off')
  })
})

describe('compareProject', () => {
  const hub = {
    id: 'x', name: 'NGH A',
    rows: [{ catNum: '03', head: '03 Civil', budget: 100, woApproved: 50, actual: 40 }],
    subRows: [
      { subNum: '317', head: '317 Civil Contractor Cost', budget: 100, woApproved: 50, actual: 40 },
      { subNum: '701', head: '701 Panels & DBs', budget: 0, woApproved: 0, actual: 0 },
    ],
  }
  const in4 = {
    subprojectId: 43,
    rows: [{ catNum: '03', head: '03 Civil', budget: 100, woApproved: 50, actual: 45 }],
    subRows: [{ subNum: '317', head: '317 Civil Contractor Cost', budget: 100, woApproved: 50, actual: 45, catNum: '03' }],
  }
  const c = compareProject(hub, in4, 43)

  it('counts every figure once and lists only the ones that differ', () => {
    // 3 category + 3 sub (317) + 3 sub (701, hub-only but all zero → exact)
    expect(c.exact + c.near + c.off).toBe(9)
    expect(c.off).toBe(2)                       // actual on the category and on 317
    expect(c.diffs.map(d => `${d.level}:${d.code}:${d.field}`)).toEqual(['category:03:actual', 'sub:317:actual'])
  })
  it('a zero-only line missing on one side is not a difference', () => {
    expect(c.diffs.some(d => d.code === '701')).toBe(false)
  })
  it('summarise totals across projects and puts the worst first', () => {
    const s = summarise([c, { ...c, bphProjectId: 'y', off: 5 }])
    expect(s.totals.off).toBe(7)
    expect(s.projects[0].bphProjectId).toBe('y')
  })
})
