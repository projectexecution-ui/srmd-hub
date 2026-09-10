// Which cron job sends each scheduled message — so the Reports & digests page
// can offer "Send now" and read "last sent" without guessing. Keys on the left
// are catalog message keys (lib/notifications/catalog.ts); values are the job
// keys in lib/cron/schedule.ts.

export const REPORT_JOB: Record<string, string> = {
  bills_digest: 'bills-digest',
  bills_stuck_worklist: 'bills-stuck-worklist',
  engineer_digest: 'engineer-digest',
  cc_budget_approved_digest: 'cc-approval-digest',
  cc_approval_reminders: 'cc-approval-reminders',
  cc_trustee_digest: 'cc-trustee-digest',
  cc_budget_vs_actual_report: 'cc-budget-vs-actual',
}

/** The notify_user() type each scheduled message writes — usually the same as its key. */
export const REPORT_NOTIFICATION_TYPE: Record<string, string> = {
  engineer_digest: 'cc_engineer_digest',
}

export function notificationTypeFor(messageKey: string): string {
  return REPORT_NOTIFICATION_TYPE[messageKey] ?? messageKey
}
