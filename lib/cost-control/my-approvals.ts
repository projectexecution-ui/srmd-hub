// "Is this pending working sheet waiting on ME right now?" — the ONE shared
// definition used by both the dashboard bell/KPI ("N waiting on you") and the
// My Approvals page, so the two never disagree.
//
// A sheet sits at one of three chain stages, each covered by an approver role
// (see coveringApproverRole). It is waiting on a given user when:
//   • they are an admin (admins can act on every stage), OR
//   • they head the sheet's discipline (legacy cc_discipline_approvers), OR
//   • they are the NAMED approver (cc_project_approvers) for the sheet's
//     project + covering role, OR
//   • no named approver is set for that project + covering role AND the user's
//     effective cost-control role IS that covering role (role-wide fallback —
//     matches projectApproverAllows in ws-actions).

import { coveringApproverRole } from './approver-roles'

export interface PendingSheetLite {
  status: string
  project_id: string
  discipline_id: string
}

export interface MyApprovalContext {
  isAdmin: boolean
  /** Effective cost-control role (from effective_user_role), e.g. 'founder'. */
  effectiveRole: string | null
  /** discipline_ids this user heads (cc_discipline_approvers). */
  myDisciplineIds: Set<string>
  /** `${project_id}:${role}` the user is a NAMED approver for. */
  myNamedCover: Set<string>
  /** EVERY `${project_id}:${role}` that has at least one named approver — used
   *  to decide when the role-wide fallback applies (i.e. no one is named). */
  projectRolesWithNamedApprover: Set<string>
}

export function isWaitingOnMe(sheet: PendingSheetLite, ctx: MyApprovalContext): boolean {
  if (ctx.isAdmin) return true
  const role = coveringApproverRole(sheet.status)
  if (!role) return false
  if (ctx.myDisciplineIds.has(sheet.discipline_id)) return true
  const key = `${sheet.project_id}:${role}`
  if (ctx.myNamedCover.has(key)) return true
  // Role-wide fallback: only when NO one is named for this project+stage.
  if (!ctx.projectRolesWithNamedApprover.has(key) && ctx.effectiveRole === role) return true
  return false
}
