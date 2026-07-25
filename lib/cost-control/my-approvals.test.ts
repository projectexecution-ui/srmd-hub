import { describe, it, expect } from 'vitest'
import { isWaitingOnMe, type MyApprovalContext, type PendingSheetLite } from './my-approvals'

const base: MyApprovalContext = {
  isAdmin: false,
  effectiveRole: null,
  myDisciplineIds: new Set(),
  myNamedCover: new Set(),
  projectRolesWithNamedApprover: new Set(),
}
const sheet = (o: Partial<PendingSheetLite> = {}): PendingSheetLite => ({
  status: 'submitted', project_id: 'P1', discipline_id: 'D1', ...o,
})

describe('isWaitingOnMe', () => {
  it('admin sees every pending stage as actionable', () => {
    expect(isWaitingOnMe(sheet({ status: 'atm_approved' }), { ...base, isAdmin: true })).toBe(true)
  })

  it('named approver for the stage → mine', () => {
    // submitted → covering role project_head; I am named PH for P1.
    const ctx = { ...base, myNamedCover: new Set(['P1:project_head']), projectRolesWithNamedApprover: new Set(['P1:project_head']) }
    expect(isWaitingOnMe(sheet({ status: 'submitted' }), ctx)).toBe(true)
  })

  it('a DIFFERENT stage the named approver does not cover → not mine', () => {
    // I am PH; a ph_approved sheet is waiting on the Atm head, not me.
    const ctx = { ...base, myNamedCover: new Set(['P1:project_head']), projectRolesWithNamedApprover: new Set(['P1:project_head', 'P1:head']) }
    expect(isWaitingOnMe(sheet({ status: 'ph_approved' }), ctx)).toBe(false)
  })

  it('role-wide fallback: no one named for the stage AND my role covers it → mine', () => {
    const ctx = { ...base, effectiveRole: 'founder' } // no named approvers anywhere
    expect(isWaitingOnMe(sheet({ status: 'atm_approved' }), ctx)).toBe(true)
    expect(isWaitingOnMe(sheet({ status: 'partially_approved' }), ctx)).toBe(true)
  })

  it('NO fallback when someone IS named — only the named person sees it', () => {
    // A founder-role user who is NOT the named founder for P1 must not see it.
    const ctx = { ...base, effectiveRole: 'founder', projectRolesWithNamedApprover: new Set(['P1:founder']) }
    expect(isWaitingOnMe(sheet({ status: 'atm_approved' }), ctx)).toBe(false)
  })

  it('discipline head sees their discipline regardless of stage', () => {
    const ctx = { ...base, myDisciplineIds: new Set(['D1']) }
    expect(isWaitingOnMe(sheet({ status: 'ph_approved', discipline_id: 'D1' }), ctx)).toBe(true)
    expect(isWaitingOnMe(sheet({ status: 'ph_approved', discipline_id: 'D2' }), ctx)).toBe(false)
  })

  it('a role that does not match the stage and is not named → not mine', () => {
    const ctx = { ...base, effectiveRole: 'head' } // head covers ph_approved, not submitted
    expect(isWaitingOnMe(sheet({ status: 'submitted' }), ctx)).toBe(false)
  })
})
