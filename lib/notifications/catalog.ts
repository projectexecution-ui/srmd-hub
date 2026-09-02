// ONE ROOF for everything CT Hub sends out.
//
// Today the answer to "who gets this mail, and can I test it" is spread across
// four screens and ~15 app_settings keys, and the twelve mail-sending cron jobs
// each resolve their own recipients. The on/off switches were already central
// (NOTIFICATION_EVENTS → /admin/notifications); WHO GETS IT never was.
//
// This file is the missing half. One row per outbound message — the 22 instant
// events AND the scheduled reports — each declaring where its recipients
// actually come from and where it is configured today. Same idea as
// lib/modules.ts: one registry, everything else reads it.
//
// RULES FOR THIS FILE
//  1. A row describes what the code ACTUALLY does today, not what it should do.
//     `respectsRules: false` is a finding, not a bug to hide.
//  2. Every row needs a `trigger` a person can read. No jargon.
//  3. When a message's recipients come from an app_settings key, name the key.
//     That key is the thing the unified screen edits.

import { NOTIFICATION_EVENTS, type NotificationChannelKey } from '@/lib/notification-events'

/** Instant = fired by something happening. Scheduled = a cron job sends it. */
export type DeliveryKind = 'instant' | 'scheduled'

/**
 * Where the list of people comes from. This is the part that was scattered.
 *
 *  derived     — worked out from roles/permissions at send time. Nothing to set.
 *  actor       — the one person it happened to (the raiser, the mentioned, …).
 *  approvers   — resolved from the approval matrix for that document.
 *  assignment  — a per-person map of projects held in app_settings.
 *  addresses   — a plain list of email addresses in app_settings.
 */
export type RecipientSource =
  | { kind: 'derived'; who: string }
  | { kind: 'actor'; who: string }
  | { kind: 'approvers'; who: string }
  | { kind: 'assignment'; who: string; settingKey: string }
  | { kind: 'addresses'; who: string; settingKey: string }

export interface OutboundMessage {
  /** Stable key. For instant messages this IS the notify_user() type. */
  key: string
  label: string
  /** Module slug it belongs to, so the roof can group by module. */
  module: string
  kind: DeliveryKind
  /** Plain words: what makes this go out. */
  trigger: string
  /** Channels it can use today. */
  channels: NotificationChannelKey[]
  /**
   * Does it go through notify_user(), and therefore obey the on/off switches on
   * /admin/notifications? Where this is false the message ignores those
   * switches entirely — turning the event off on that page does nothing.
   */
  respectsRules: boolean
  recipients: RecipientSource
  /** When it goes, in words. Instant messages leave this unset. */
  schedule?: string
  /** app_settings key that switches the whole message off, where one exists. */
  enabledKey?: string
  /** Where it is configured today — the roof deep-links here rather than
   *  re-implementing each module's own screen. */
  settingsHref: string
}

/** Every instant event carries the same three channels today. */
const ALL: NotificationChannelKey[] = ['in_app', 'email', 'web_push']
const RULES_PAGE = '/admin/notifications'

/**
 * The scheduled reports. These are the ones with no single home — each was
 * built with its own recipient store and its own settings screen.
 */
export const SCHEDULED_MESSAGES: OutboundMessage[] = [
  {
    key: 'bills_digest',
    label: 'Bills — daily digest',
    module: 'bills-pipeline',
    kind: 'scheduled',
    trigger: 'Each person gets the bills sitting on their desk, for the projects assigned to them.',
    channels: ['in_app', 'email'],
    respectsRules: true,
    recipients: { kind: 'assignment', who: 'Named people, each with their own project list', settingKey: 'bills_digest_assignments' },
    schedule: 'Daily, morning slot',
    enabledKey: 'bills_digest_enabled',
    settingsHref: '/bills-pipeline/digest-settings',
  },
  {
    key: 'bills_stuck_worklist',
    label: 'Bills — stuck worklist',
    module: 'bills-pipeline',
    kind: 'scheduled',
    trigger: 'The bills that have stopped moving, as a single chase-list.',
    channels: ['email'],
    // Sends straight to the address list — does NOT go through notify_user.
    respectsRules: false,
    recipients: { kind: 'addresses', who: 'A plain address list', settingKey: 'bills_worklist_to' },
    schedule: 'Daily, morning slot',
    settingsHref: '/bills-pipeline/digest-settings',
  },
  {
    key: 'procurement_digest',
    label: 'Indent → PO — follow-up',
    module: 'procurement-tracker',
    kind: 'scheduled',
    trigger: 'POs to raise (2+ days) and deliveries to chase (7+ days), per Atm Head, only their projects.',
    channels: ['in_app', 'email'],
    respectsRules: true,
    recipients: { kind: 'assignment', who: 'Atm Heads, each with their own project list', settingKey: 'procurement_notify_assignments' },
    schedule: 'Weekdays',
    enabledKey: 'procurement_notify_enabled',
    settingsHref: '/procurement-tracker/reminders',
  },
  {
    key: 'engineer_digest',
    label: 'Engineers — daily digest',
    module: 'cost-control',
    kind: 'scheduled',
    trigger: "What each engineer has open — sheets returned, budgets moving.",
    channels: ['in_app', 'email'],
    respectsRules: true,
    recipients: { kind: 'derived', who: 'Each engineer, worked out at send time' },
    schedule: 'Daily, morning slot',
    settingsHref: RULES_PAGE,
  },
  {
    key: 'daily_site_report_digest',
    label: 'Daily Site Report — digest',
    module: 'daily-site-report',
    kind: 'scheduled',
    trigger: "The day's site deliveries and what is still outstanding.",
    channels: ['in_app', 'email'],
    respectsRules: true,
    recipients: { kind: 'derived', who: 'Atm Heads via cc_project_approvers' },
    schedule: 'Daily',
    settingsHref: '/daily-site-report/digest',
  },
  {
    key: 'inventory_daily_report',
    label: 'Inventory — daily report',
    module: 'inventory',
    kind: 'scheduled',
    trigger: 'Yesterday\'s stock movement.',
    channels: ['email'],
    // Straight to the address list — bypasses notify_user.
    respectsRules: false,
    recipients: { kind: 'addresses', who: 'A plain address list', settingKey: 'inv_daily_report_emails' },
    schedule: 'Daily, morning slot',
    settingsHref: '/inventory/settings',
  },
  {
    key: 'inv_site_stock_reminder',
    label: 'Inventory — low stock alert',
    module: 'inventory',
    kind: 'scheduled',
    trigger: 'An item has fallen below its reorder level.',
    channels: ['in_app', 'email'],
    respectsRules: true,
    recipients: { kind: 'addresses', who: 'Per-store alert list', settingKey: 'inv_low_stock_alerts' },
    schedule: 'Daily, morning slot',
    settingsHref: '/inventory/settings',
  },
  {
    key: 'jmr_weekly_report',
    label: 'JMR — weekly report',
    module: 'jmr',
    kind: 'scheduled',
    trigger: "The week's measurement entries, as one report.",
    channels: ['email'],
    respectsRules: false,
    recipients: { kind: 'addresses', who: 'A plain address list', settingKey: 'jmr_weekly_report_recipients' },
    schedule: 'Weekly',
    settingsHref: '/jmr/admin',
  },
  {
    key: 'cc_budget_approved_digest',
    label: 'Cost Control — budgets approved today',
    module: 'cost-control',
    kind: 'scheduled',
    trigger: 'A once-a-day summary of what the Trustee approved.',
    channels: ['in_app', 'email'],
    respectsRules: true,
    recipients: { kind: 'derived', who: 'Project Head and the engineer who raised each' },
    schedule: 'Daily, both slots (morning batch is the reliable one)',
    settingsHref: RULES_PAGE,
  },
  {
    key: 'cc_approval_reminders',
    label: 'Cost Control — approval reminders',
    module: 'cost-control',
    kind: 'scheduled',
    trigger: 'Budgets still waiting on a desk since a previous day; escalates at 3+ days.',
    channels: ['in_app'],
    respectsRules: true,
    recipients: { kind: 'approvers', who: 'The pending approver, then the level above' },
    schedule: 'Daily — arrives as a Telegram card',
    settingsHref: RULES_PAGE,
  },
  {
    key: 'cc_trustee_digest',
    label: 'Cost Control — Trustee digest',
    module: 'cost-control',
    kind: 'scheduled',
    trigger: 'What is waiting on the Trustee.',
    channels: ['in_app'],
    respectsRules: true,
    recipients: { kind: 'derived', who: 'The Trustee' },
    schedule: 'Daily — Telegram, only while switched on',
    enabledKey: 'cc_tg_trustee_digest',
    settingsHref: '/cost-control/settings',
  },
  {
    key: 'cc_budget_vs_actual_report',
    label: 'Cost Control — Budget vs Actual (weekly)',
    module: 'cost-control',
    kind: 'scheduled',
    trigger: 'The portfolio tree — Budget · Spent · Outstanding + ₹/sft, flagging stale sources.',
    channels: ['in_app'],
    respectsRules: true,
    recipients: { kind: 'derived', who: 'Cost Control reviewers only — confidential' },
    schedule: 'Monday morning — Telegram card',
    settingsHref: RULES_PAGE,
  },
  {
    key: 'sched_promise_nudge',
    label: 'Schedule — weekly promise nudge',
    module: 'schedule',
    kind: 'scheduled',
    trigger: "Monday plan ping, then an evening reminder of promises still open.",
    channels: ['in_app', 'email'],
    respectsRules: true,
    recipients: { kind: 'derived', who: 'Each responsible engineer' },
    schedule: 'Mondays + evenings',
    settingsHref: '/schedule/settings',
  },
]

/**
 * The instant events, derived from the existing registry so the two can never
 * drift. Everything here already obeys /admin/notifications; what it lacked was
 * a stated recipient source next to the switch.
 */
const INSTANT_RECIPIENTS: Record<string, RecipientSource> = {
  access_request:        { kind: 'derived',   who: 'Admins & Portal Owners' },
  access_approved:       { kind: 'actor',     who: 'The approved person' },
  approval_pending:      { kind: 'approvers', who: 'Whoever may approve it' },
  cc_estimate_approved:  { kind: 'derived',   who: 'IN4-entry team (Billing / Coordinator)' },
  cc_ws_returned:        { kind: 'actor',     who: 'The engineer who raised the sheet' },
  cc_budget_approved:    { kind: 'derived',   who: "The project's Atm Head" },
  cc_budget_transfer:    { kind: 'derived',   who: "The project's named Atm Head" },
  jmr_entry_submitted:   { kind: 'approvers', who: 'Approvers (admin & head)' },
  jmr_entry_approved:    { kind: 'actor',     who: 'The engineer who logged it' },
  jmr_entry_flagged:     { kind: 'actor',     who: 'The engineer who logged it' },
  wh_request_raised:     { kind: 'approvers', who: 'Whoever can approve it' },
  wh_request_decided:    { kind: 'actor',     who: 'The engineer who raised it' },
  wh_request_to_issue:   { kind: 'derived',   who: 'The store keeper, or whoever may issue' },
  wh_request_issued:     { kind: 'actor',     who: 'The engineer who raised it' },
  wh_return_waived:      { kind: 'actor',     who: 'The engineer who borrowed it' },
  comment_mention:       { kind: 'actor',     who: 'The tagged person' },
  email_health:          { kind: 'derived',   who: 'Admins' },
}

const INSTANT_MODULE: Record<string, string> = {
  access_request: 'admin-users', access_approved: 'admin-users', email_health: 'admin-settings',
  approval_pending: 'approvals', comment_mention: 'cost-control',
  cc_estimate_approved: 'cost-control', cc_ws_returned: 'cost-control',
  cc_budget_approved: 'cost-control', cc_budget_transfer: 'cost-control',
  jmr_entry_submitted: 'jmr', jmr_entry_approved: 'jmr', jmr_entry_flagged: 'jmr',
  wh_request_raised: 'warehouse', wh_request_decided: 'warehouse',
  wh_request_to_issue: 'warehouse', wh_request_issued: 'warehouse', wh_return_waived: 'warehouse',
}

/** Events that the SCHEDULED list already covers — not repeated as instant. */
const COVERED_BY_SCHEDULE = new Set(
  SCHEDULED_MESSAGES.map(m => m.key),
)

export const INSTANT_MESSAGES: OutboundMessage[] = NOTIFICATION_EVENTS
  .filter(e => !COVERED_BY_SCHEDULE.has(e.type))
  .map(e => ({
    key: e.type,
    label: e.label,
    module: INSTANT_MODULE[e.type] ?? 'admin-settings',
    kind: 'instant' as const,
    trigger: e.description,
    channels: ALL,
    respectsRules: true,
    recipients: INSTANT_RECIPIENTS[e.type] ?? { kind: 'derived', who: e.audience },
    settingsHref: RULES_PAGE,
  }))

/** Everything the hub sends, in one list. */
export const OUTBOUND: OutboundMessage[] = [...SCHEDULED_MESSAGES, ...INSTANT_MESSAGES]

/** Grouped by module, for a screen that reads module by module. */
export function byModule(list: OutboundMessage[] = OUTBOUND): Array<{ module: string; messages: OutboundMessage[] }> {
  const m = new Map<string, OutboundMessage[]>()
  for (const o of list) {
    const arr = m.get(o.module)
    if (arr) arr.push(o)
    else m.set(o.module, [o])
  }
  return [...m.entries()]
    .map(([module, messages]) => ({ module, messages }))
    .sort((a, b) => a.module.localeCompare(b.module))
}

/** Every app_settings key the roof needs to read to show current recipients. */
export function recipientSettingKeys(list: OutboundMessage[] = OUTBOUND): string[] {
  const keys = new Set<string>()
  for (const o of list) {
    if (o.recipients.kind === 'addresses' || o.recipients.kind === 'assignment') {
      keys.add(o.recipients.settingKey)
    }
    if (o.enabledKey) keys.add(o.enabledKey)
  }
  return [...keys].sort()
}

/**
 * The messages that IGNORE the switches on /admin/notifications. Turning the
 * event off there does nothing for these — they send to their own address list
 * regardless. Worth surfacing rather than leaving as a trap.
 */
export function ignoresTheSwitches(list: OutboundMessage[] = OUTBOUND): OutboundMessage[] {
  return list.filter(o => !o.respectsRules)
}

/** How scattered it is today, measured rather than asserted. */
export function spread(list: OutboundMessage[] = OUTBOUND): {
  messages: number; screens: number; settingKeys: number; ignoring: number
} {
  return {
    messages: list.length,
    screens: new Set(list.map(o => o.settingsHref)).size,
    settingKeys: recipientSettingKeys(list).length,
    ignoring: ignoresTheSwitches(list).length,
  }
}
