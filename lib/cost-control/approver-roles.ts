// Which approver role covers a Cost Control working sheet at each status.
// Pure helper shared by the dashboard "waiting on you" bell and the approvals
// inbox. (Email delivery itself is native — the DB notify_on_approval_event
// trigger emails approvers via the Gmail queue; see notification_rules.)

export type ApproverRole = 'project_head' | 'head' | 'founder'

/** The approver role responsible for a sheet at a given status (null = none). */
export function coveringApproverRole(status: string): ApproverRole | null {
  switch (status) {
    case 'submitted':          return 'project_head'
    case 'ph_approved':        return 'head'
    case 'atm_approved':
    case 'partially_approved': return 'founder'
    default:                   return null
  }
}
