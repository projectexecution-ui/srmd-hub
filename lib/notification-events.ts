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
    type: 'in4_indent_verify',
    label: 'IN4 — indent waiting for approval',
    description: 'An indent in IN4 reached Verify; the Atm Head of the linked project is asked to approve it in IN4.',
    audience: 'Atm Heads (per project)',
  },
  {
    type: 'in4_po_verify',
    label: 'IN4 — purchase order waiting for approval',
    description: 'A purchase order in IN4 reached Verify; the Atm Head of the linked project is asked to approve it in IN4.',
    audience: 'Atm Heads (per project)',
  },
  {
    type: 'in4_wo_verify',
    label: 'IN4 — work order waiting for approval',
    description: 'A work order in IN4 reached Verify; the Atm Head of the linked project is asked to approve it in IN4. The WO / PO tab shows every rate against the last one paid.',
    audience: 'Atm Heads (per project)',
  },
  {
    type: 'in4_grn_received',
    label: 'IN4 — material received',
    description: 'A GRN was approved in IN4 against one of the project’s purchase orders.',
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
    type: 'cc_budget_transfer',
    label: 'Budget moved inside one of your categories',
    description: 'Budget was transferred between two sub-categories of the same work category in IN4. '
      + 'Nothing was approved in CT Hub and the category total does not change, so without this it '
      + 'happens unseen — one line simply looks short and another looks like it grew on its own.',
    audience: 'The project’s named Atm Head',
  },
  {
    type: 'cc_transfer_pending',
    label: 'Budget transfer waiting for your approval',
    description: 'Somebody has asked to move approved budget from one work category to another. '
      + 'It crosses two categories, so what each was approved to spend changes — which is why it '
      + 'is signed rather than just done. Sent to whoever it is with now: the Atm Head first, then the Trustee.',
    audience: 'The Atm Head, then the Trustee',
  },
  {
    type: 'cc_transfer_rejected',
    label: 'Budget transfer turned down',
    description: 'A transfer was not approved, with the reason. Goes to the person who raised it, '
      + 'so they learn what to change rather than waiting on a request that will never move.',
    audience: 'The person who raised it',
  },
  {
    type: 'cc_transfer_awaiting_in4',
    label: 'Budget transfer to be made in IN4',
    description: 'Fully approved and now waiting on the ERP. CT Hub never writes a budget itself, so '
      + 'nothing changes until somebody makes the move in IN4 and ticks it in the billing queue.',
    audience: 'Billing & the Coordinator',
  },
  {
    type: 'cc_transfer_confirmed',
    label: 'Budget transfer confirmed against IN4',
    description: 'A sync checked both lines and found they moved by the approved amount, so the request '
      + 'closed itself. Confirmation that the ERP and CT Hub agree, rather than someone having to compare them.',
    audience: 'The raiser and both approvers',
  },
  {
    type: 'cc_transfer_mismatch',
    label: 'Budget transfer does not match IN4',
    description: 'A transfer was approved and recorded as done, but the sync found the two lines did not '
      + 'move as approved — a partial move, the wrong line, or nothing at all. The request stays open and '
      + 'says what actually happened, because a transfer that was signed and never made is the case most '
      + 'worth catching early.',
    audience: 'The raiser and the Coordinator',
  },
  {
    type: 'comment_mention',
    label: 'You were @mentioned in a comment',
    description: 'When someone tags you with @ in a comment (any module), you get the comment and a link straight to it.',
    audience: 'The tagged person',
  },
  {
    type: 'sr_assigned',
    label: 'Site Register — an entry is assigned to you',
    description: 'A site issue, query, instruction or non-conformance has been put in your name, with a date it is due back. Sent when it is raised and again whenever it is reassigned to you.',
    audience: 'The person it is assigned to',
  },
  {
    type: 'sr_replied',
    label: 'Site Register — a reply on your entry',
    description: 'Someone has replied on an entry you raised or one assigned to you. A reply from the assigned person also returns the entry to whoever raised it.',
    audience: 'The other party on the entry',
  },
  {
    type: 'sr_closed',
    label: 'Site Register — an entry was closed',
    description: 'The person who raised an entry has closed it. Goes to whoever it was last assigned to, so nobody keeps working on something already settled.',
    audience: 'The person it was assigned to',
  },
  {
    type: 'email_health',
    label: 'Notification delivery problem',
    description: 'Bell-only alert to admins when email or phone-push alerts could not be delivered after retries (so a broken channel can still report itself).',
    audience: 'Admins',
  },
]

/** Channels the admin policy controls. Telegram joined on 11 Sep 2026 once
 *  notify_user() started asking notification_allowed() for it (migration
 *  20260911_notify_user_telegram_rule) — before that no switch could stop a DM. */
export const NOTIFICATION_CHANNELS = [
  { key: 'in_app', label: 'In-app', help: 'The bell inside CT HUB.' },
  { key: 'email', label: 'Email', help: 'Sent to the user’s email.' },
  { key: 'web_push', label: 'Phone', help: 'Push notification on the phone/desktop, even when CT HUB is closed.' },
  { key: 'telegram', label: 'Telegram', help: 'Telegram card or message, for people who linked Telegram from their Settings.' },
] as const

export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number]['key']

/** Built-in fallback when no rule exists anywhere — must match the SQL
 *  notification_allowed() default (all channels on; phone push is still gated
 *  per-user by the Web-push preference + a registered device). */
export function builtInDefault(_channel: string): boolean {
  return true
}
