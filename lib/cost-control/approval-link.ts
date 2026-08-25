// ONE definition of "where an approval link lands".
//
// The HOD's rule: a pending budget approval must NOT drop you straight onto the
// voucher. It opens the PROJECT first — only that work category expanded, the
// sub-skill highlighted — so the approver sees what he is approving *against*
// (Internal Estimate, already released, ERP budget) before he signs. From there
// he steps into the voucher and approves.
//
// `ws` carries the exact sheet so the project page can offer a one-tap
// "Open the sheet to approve" instead of making him hunt for the amber figure.
//
// Mirrored in SQL by public.fn_cc_ws_approval_url() — the inbox RPC and the
// notification/email trigger build the same URL. Keep the two in step.

export interface CcApprovalTarget {
  projectId: string | null
  disciplineId?: string | null
  subSkillId?: string | null
  wsId?: string | null
}

/** Project-first approval path. Falls back to the voucher when there is no
 *  project to open onto (orphan sheet) — never returns a dead link. */
export function ccApprovalPath(t: CcApprovalTarget): string {
  if (!t.projectId) {
    return t.wsId ? `/cost-control/working-sheets/${t.wsId}` : '/cost-control'
  }
  const qs = new URLSearchParams()
  if (t.disciplineId) qs.set('focus_disc', t.disciplineId)
  if (t.subSkillId) qs.set('focus_sub', t.subSkillId)
  if (t.wsId) qs.set('ws', t.wsId)
  const s = qs.toString()
  return `/cost-control/projects/${t.projectId}${s ? `?${s}` : ''}`
}
