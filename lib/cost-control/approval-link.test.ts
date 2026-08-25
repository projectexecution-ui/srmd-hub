import { describe, it, expect } from 'vitest'
import { ccApprovalPath } from './approval-link'

const P = '768e48c0-6a01-4c95-b406-1ccc8c82a93b'
const D = '11111111-1111-1111-1111-111111111111'
const S = '22222222-2222-2222-2222-222222222222'
const W = '33333333-3333-3333-3333-333333333333'

describe('ccApprovalPath', () => {
  it('opens the project focused on the category, sub-skill and sheet', () => {
    expect(ccApprovalPath({ projectId: P, disciplineId: D, subSkillId: S, wsId: W }))
      .toBe(`/cost-control/projects/${P}?focus_disc=${D}&focus_sub=${S}&ws=${W}`)
  })

  it('omits focus params that are missing rather than sending empty ones', () => {
    expect(ccApprovalPath({ projectId: P, disciplineId: null, subSkillId: null, wsId: W }))
      .toBe(`/cost-control/projects/${P}?ws=${W}`)
  })

  it('falls back to the voucher when the sheet has no project', () => {
    expect(ccApprovalPath({ projectId: null, wsId: W }))
      .toBe(`/cost-control/working-sheets/${W}`)
  })

  it('never returns a dead link when nothing is known', () => {
    expect(ccApprovalPath({ projectId: null })).toBe('/cost-control')
  })
})
