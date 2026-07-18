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
    type: 'procurement_digest',
    label: 'Indent → PO daily follow-up',
    description: 'Weekday reminder to each Atm Head — POs to raise (2+ days) and deliveries to chase (1 week+), only their projects.',
    audience: 'Atm Heads (per project)',
  },
]

/** Channels the admin policy controls. (Telegram is per-user only; web_push
 *  is added here once the push sender is built.) */
export const NOTIFICATION_CHANNELS = [
  { key: 'in_app', label: 'In-app', help: 'The bell inside CT HUB.' },
  { key: 'email', label: 'Email', help: 'Sent to the user’s email.' },
] as const

export type NotificationChannelKey = (typeof NOTIFICATION_CHANNELS)[number]['key']

/** Built-in fallback when no rule exists anywhere — must match the SQL
 *  notification_allowed() default (in-app + email on, push off). */
export function builtInDefault(channel: string): boolean {
  return channel !== 'web_push'
}
