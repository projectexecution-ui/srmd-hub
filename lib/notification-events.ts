// The catalogue of notification event types the hub can raise, with
// layman-friendly labels for the admin Notifications page. Add an entry here
// when a new notify_user(type, …) is introduced so it shows up as a row the
// admin can control. Unknown types not listed here still notify by default
// (notification_allowed falls back to the built-in default).

export interface NotificationEventDef {
  /** The `type` passed to notify_user(). Must match the trigger/code. */
  type: string
  label: string
  description: string
  /** Who receives this event (shown for context — not enforced here). */
  audience: string
}

export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  {
    type: 'access_request',
    label: 'New access request',
    description: 'Someone signed in via the shared link and is awaiting approval.',
    audience: 'Admins & Portal Owners',
  },
  {
    type: 'access_approved',
    label: 'Access approved',
    description: "A person's access was approved — the welcome notice goes to that person.",
    audience: 'The approved user',
  },
  {
    type: 'approval_pending',
    label: 'Approval needed',
    description: 'A document is waiting for someone to approve or reject it.',
    audience: 'Eligible approvers',
  },
  {
    type: 'sched_promise_nudge',
    label: 'Schedule — weekly promise nudge',
    description: 'Monday "your week\'s promises" plan ping + evening reminder of still-open promises, to each responsible engineer.',
    audience: 'Promise owners (engineers)',
  },
  {
    type: 'procurement_digest',
    label: 'Indent → PO daily follow-up',
    description: 'Weekday reminder to each Atm Head — POs to raise (2+ days) and deliveries to chase (1 week+), only their projects.',
    audience: 'Atm Heads (per project)',
  },
  {
    type: 'cc_estimate_approved',
    label: 'Budget approved by Trustee → enter in IN4',
    description: 'When the Trustee approves/releases a working sheet, the IN4-entry person is told to key it into IN4 and mark it done.',
    audience: 'IN4-entry team (Billing / Coordinator)',
  },
  {
    type: 'cc_ws_returned',
    label: 'Working sheet returned to engineer',
    description: 'When an approver sends a Cost Control working sheet back for changes, the engineer who raised it is told, with the return reason and a link to fix it.',
    audience: 'The engineer who raised the sheet',
  },
  {
    type: 'cc_budget_approved',
    label: 'Budget approved by Trustee (Atm Head, instant)',
    description: 'The moment the Trustee approves/releases a working sheet, its Atm Head is told it went through.',
    audience: 'Atm Head (per project)',
  },
  {
    type: 'cc_budget_approved_digest',
    label: 'Daily: budgets approved by Trustee',
    description: 'A once-a-day summary of the budgets the Trustee approved, to the Project Head and the engineer who raised each.',
    audience: 'Project Head & raising engineer',
  },
  {
    type: 'cc_approval_reminders',
    label: 'Daily: budget waiting for approval (reminder)',
    description: 'Each morning, reminds the current approver (Project Head / Atm Head / Trustee) of budgets still waiting on their sign-off since a previous day — not on the day it was raised. If a budget is stuck 3+ days, it also copies the next level up + management. Arrives as a Telegram card.',
    audience: 'The pending approver (+ escalation to the next level & management)',
  },
  {
    type: 'cc_budget_vs_actual_report',
    label: 'Weekly: Budget vs Actual (portfolio tree)',
    description: 'A Monday-morning portfolio card to management, mirroring the Budget vs Actual V2 tree — projects grouped by block, each showing Budget · Spent · Outstanding + ₹/sft, with a warning when a source is 14+ days stale. Confidential — goes to Cost Control management/reviewers only. Arrives as a Telegram card.',
    audience: 'Management (Cost Control reviewers)',
  },
  {
    type: 'jmr_entry_submitted',
    label: 'JMR entry submitted (to review)',
    description: 'The moment an engineer submits a daily JMR entry, the approvers (admin/head) are pinged that there’s something to review. Email is off by default for this one to avoid inbox flooding — in-app + phone push stay on; turn email on here if you want it.',
    audience: 'Approvers (admin & head)',
  },
  {
    type: 'jmr_entry_approved',
    label: 'JMR entry approved',
    description: 'When a Head/PM approves a daily JMR entry, the engineer who logged it is told (with the approver’s note).',
    audience: 'The engineer who logged it',
  },
  {
    type: 'jmr_entry_flagged',
    label: 'JMR entry flagged',
    description: 'When a Head/PM flags a daily JMR entry, the engineer who logged it is told the reason so they can fix or re-log.',
    audience: 'The engineer who logged it',
  },
  {
    type: 'comment_mention',
    label: 'You were @mentioned in a comment',
    description: 'When someone tags you with @ in a comment (any module), you get the comment and a link straight to it.',
    audience: 'The tagged person',
  },
  {
    type: 'email_health',
    label: 'Notification delivery problem',
    description: 'Bell-only alert to admins when email or phone-push alerts could not be delivered after retries (so a broken channel can still report itself).',
    audience: 'Admins',
  },
]

/** Channels the admin policy controls. (Telegram is per-user only; web_push
 *  is added here once the push sender is built.) */
export const NOTIFICATION_CHANNELS = [
  { key: 'in_app', label: 'In-app', help: 'The bell inside CT HUB.' },
  { key: 'email', label: 'Email', help: 'Sent to the user’s email.' },
  { key: 'web_push', label: 'Phone', help: 'Push notification on the phone/desktop, even when CT HUB is closed.' },
] as const

export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number]['key']

/** Built-in fallback when no rule exists anywhere — must match the SQL
 *  notification_allowed() default (all channels on; phone push is still gated
 *  per-user by the Web-push preference + a registered device). */
export function builtInDefault(_channel: string): boolean {
  return true
}
