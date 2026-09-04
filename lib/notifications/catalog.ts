// ONE ROOF for everything CT Hub sends out.
//
// The on/off switches were already central (NOTIFICATION_EVENTS →
// /admin/notifications). WHO GETS IT never was: six modules each grew their own
// recipient list in app_settings and their own settings screen. This file is
// the missing half — one row per outbound message, instant or scheduled,
// declaring where its recipients come from and which setting key holds them.
// /admin/notifications/recipients reads it and edits those keys in place.
//
// RULES FOR THIS FILE
//  1. A row describes what the code ACTUALLY does today, not what it should do.
//     `respectsRules: false` is a finding, not a bug to hide.
//  2. Every row needs a `trigger` a person can read. No jargon.
//  3. When a message's recipients come from an app_settings key, name the key
//     and its format. That key is the thing the recipients screen edits.

import { NOTIFICATION_EVENTS, type NotificationChannelKey } from '@/lib/notification-events'

export type DeliveryKind = 'instant' | 'scheduled'

/** How a list of addresses is stored in its app_settings key. */
export type AddressFormat = 'csv' | 'json-array'

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
  | { kind: 'assignment'; who: string; settingKey: string; projectList: 'bills' | 'tracker'; ccKey?: string }
  | { kind: 'addresses'; who: string; settingKey: string; format: AddressFormat }

export interface OutboundMessage {
  /** Stable key. For instant messages this IS the notify_user() type. */
  key: string
  label: string
  /** Module slug it belongs to, so the screen can group by module. */
  module: string
  kind: DeliveryKind
  /** Plain words: what makes this go out. */
  trigger: string
  channels: NotificationChannelKey[]
  /**
   * Does it go through notify_user(), and therefore obey the on/off switches on
   * /admin/notifications? Where false, the message ignores those switches —
   * turning the event off there does nothing.
   */
  respectsRules: boolean
  recipients: RecipientSource
  /** When it goes, in words. Instant messages leave this unset. */
  schedule?: string
  /** app_settings key ('true'/'false') that switches the whole message off. */
  enabledKey?: string
  /** The module's own screen for everything beyond recipients. */
  settingsHref: string
}

const ALL: NotificationChannelKey[] = ['in_app', 'email', 'web_push']
const RULES_PAGE = '/admin/notifications'

/** The scheduled reports — the ones that had no single home. */
export const SCHEDULED_MESSAGES: OutboundMessage[] = [
  {
    key: 'bills_digest', label: 'Bills — daily digest', module: 'bills-pipeline', kind: 'scheduled',
    trigger: 'Each Atm Head gets the bills sitting on their desk, one card per project assigned to them.',
    channels: ['in_app', 'email'], respectsRules: true,
    recipients: { kind: 'assignment', who: 'Named people, each with their own project list', settingKey: 'bills_digest_assignments', projectList: 'bills', ccKey: 'bills_digest_cc' },
    schedule: 'Daily, 09:00 IST', enabledKey: 'bills_digest_enabled', settingsHref: '/bills-pipeline/digest-settings',
  },
  {
    key: 'bills_stuck_worklist', label: 'Bills — stuck worklist', module: 'bills-pipeline', kind: 'scheduled',
    trigger: 'The bills that have stopped moving, as one chase-list.',
    channels: ['email'], respectsRules: false,
    recipients: { kind: 'addresses', who: 'A plain address list', settingKey: 'bills_worklist_to', format: 'csv' },
    schedule: 'Daily, 09:00 IST', settingsHref: '/bills-pipeline/digest-settings',
  },
  {
    key: 'procurement_digest', label: 'Indent → PO — follow-up', module: 'procurement-tracker', kind: 'scheduled',
    trigger: 'POs to raise (2+ days) and deliveries to chase (7+ days), per Atm Head, only their projects.',
    channels: ['in_app', 'email'], respectsRules: true,
    recipients: { kind: 'assignment', who: 'Atm Heads, each with their own project list', settingKey: 'procurement_notify_assignments', projectList: 'tracker' },
    schedule: 'Weekdays, 09:00 IST', enabledKey: 'procurement_notify_enabled', settingsHref: '/procurement-tracker/admin',
  },
  {
    key: 'engineer_digest', label: 'Engineers — daily digest', module: 'cost-control', kind: 'scheduled',
    trigger: 'What each engineer has open — sheets returned, budgets moving.',
    channels: ['in_app', 'email'], respectsRules: true,
    recipients: { kind: 'derived', who: 'Each engineer, worked out at send time' },
    schedule: 'Daily, 09:00 IST', settingsHref: RULES_PAGE,
  },
  {
    key: 'daily_site_report_digest', label: 'Daily Site Report — digest', module: 'daily-site-report', kind: 'scheduled',
    trigger: "The day's site deliveries and what is still outstanding.",
    channels: ['in_app', 'email'], respectsRules: true,
    recipients: { kind: 'derived', who: 'Atm Heads, from each project’s approvers' },
    schedule: 'Daily', settingsHref: '/daily-site-report/digest',
  },
  {
    key: 'inventory_daily_report', label: 'Inventory — daily report', module: 'inventory', kind: 'scheduled',
    trigger: "Yesterday's stock movement.",
    channels: ['email'], respectsRules: false,
    recipients: { kind: 'addresses', who: 'Admins, plus a plain address list', settingKey: 'inv_daily_report_emails', format: 'csv' },
    schedule: 'Daily, 09:00 IST', enabledKey: 'inv_daily_report', settingsHref: '/inventory/admin/settings',
  },
  {
    key: 'inv_site_stock_reminder', label: 'Inventory — low stock alert', module: 'inventory', kind: 'scheduled',
    trigger: 'An item has fallen below its reorder level.',
    channels: ['in_app', 'email'], respectsRules: true,
    recipients: { kind: 'derived', who: 'Engineers assigned to the site' },
    schedule: 'Daily, 09:00 IST', enabledKey: 'inv_low_stock_alerts', settingsHref: '/inventory/admin/settings',
  },
  {
    key: 'jmr_weekly_report', label: 'JMR — weekly report', module: 'jmr', kind: 'scheduled',
    trigger: "The week's measurement entries, as one report.",
    channels: ['email'], respectsRules: false,
    recipients: { kind: 'addresses', who: 'A plain address list', settingKey: 'jmr_weekly_report_recipients', format: 'json-array' },
    schedule: 'Weekly', settingsHref: '/jmr/admin/settings',
  },
  {
    key: 'cc_budget_approved_digest', label: 'Cost Control — budgets approved today', module: 'cost-control', kind: 'scheduled',
    trigger: 'A once-a-day summary of what the Trustee approved.',
    channels: ['in_app', 'email'], respectsRules: true,
    recipients: { kind: 'derived', who: 'Project Head and the engineer who raised each' },
    schedule: 'Daily (the morning slot is the reliable one)', settingsHref: RULES_PAGE,
  },
  {
    key: 'cc_approval_reminders', label: 'Cost Control — approval reminders', module: 'cost-control', kind: 'scheduled',
    trigger: 'Budgets still waiting on a desk since a previous day; escalates at 3+ days.',
    channels: ['in_app'], respectsRules: true,
    recipients: { kind: 'approvers', who: 'The pending approver, then the level above' },
    schedule: 'Daily — arrives as a Telegram card', settingsHref: RULES_PAGE,
  },
  {
    key: 'cc_trustee_digest', label: 'Cost Control — Trustee digest', module: 'cost-control', kind: 'scheduled',
    trigger: 'What is waiting on the Trustee.',
    channels: ['in_app'], respectsRules: true,
    recipients: { kind: 'derived', who: 'The Trustee' },
    schedule: 'Daily — Telegram, only while switched on', enabledKey: 'cc_tg_trustee_digest', settingsHref: '/cost-control/settings',
  },
  {
    key: 'cc_budget_vs_actual_report', label: 'Cost Control — Budget vs Actual (weekly)', module: 'cost-control', kind: 'scheduled',
    trigger: 'The portfolio tree — Budget · Spent · Outstanding, flagging stale sources.',
    channels: ['in_app'], respectsRules: true,
    recipients: { kind: 'derived', who: 'Cost Control reviewers only — confidential' },
    schedule: 'Monday morning — Telegram card', settingsHref: RULES_PAGE,
  },
  {
    key: 'sched_promise_nudge', label: 'Schedule — weekly promise nudge', module: 'schedule', kind: 'scheduled',
    trigger: 'Monday plan ping, then an evening reminder of promises still open.',
    channels: ['in_app', 'email'], respectsRules: true,
    recipients: { kind: 'derived', who: 'Each responsible engineer' },
    schedule: 'Mondays + evenings', settingsHref: '/schedule/settings',
  },
]

const INSTANT_RECIPIENTS: Record<string, RecipientSource> = {
  access_request:        { kind: 'derived',   who: 'Admins & Portal Owners' },
  access_approved:       { kind: 'actor',     who: 'The approved person' },
  approval_pending:      { kind: 'approvers', who: 'Whoever may approve it' },
  cc_estimate_approved:  { kind: 'derived',   who: 'IN4-entry team (Billing / Coordinator)' },
  cc_ws_returned:        { kind: 'actor',     who: 'The engineer who raised the sheet' },
  cc_budget_approved:    { kind: 'derived',   who: "The project's Atm Head" },
  cc_budget_transfer:    { kind: 'derived',   who: "The project's named Atm Head" },
  cc_transfer_pending:   { kind: 'approvers', who: 'Whoever may approve the transfer' },
  cc_transfer_rejected:  { kind: 'actor',     who: 'The person who requested the transfer' },
  cc_transfer_awaiting_in4: { kind: 'derived', who: 'The person with IN4 access' },
  cc_transfer_confirmed: { kind: 'actor',     who: 'The person who requested the transfer' },
  cc_transfer_mismatch:  { kind: 'derived',   who: 'The requester and the approver' },
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
  cc_estimate_approved: 'cost-control', cc_ws_returned: 'cost-control', cc_budget_approved: 'cost-control', cc_budget_transfer: 'cost-control',
  cc_transfer_pending: 'cost-control', cc_transfer_rejected: 'cost-control', cc_transfer_awaiting_in4: 'cost-control', cc_transfer_confirmed: 'cost-control', cc_transfer_mismatch: 'cost-control',
  jmr_entry_submitted: 'jmr', jmr_entry_approved: 'jmr', jmr_entry_flagged: 'jmr',
  wh_request_raised: 'warehouse', wh_request_decided: 'warehouse', wh_request_to_issue: 'warehouse', wh_request_issued: 'warehouse', wh_return_waived: 'warehouse',
}

const COVERED_BY_SCHEDULE = new Set(SCHEDULED_MESSAGES.map(m => m.key))

/** The instant events, derived from the existing registry so the two never drift. */
export const INSTANT_MESSAGES: OutboundMessage[] = NOTIFICATION_EVENTS
  .filter(e => !COVERED_BY_SCHEDULE.has(e.type))
  .map(e => ({
    key: e.type, label: e.label, module: INSTANT_MODULE[e.type] ?? 'admin-settings', kind: 'instant' as const,
    trigger: e.description, channels: ALL, respectsRules: true,
    recipients: INSTANT_RECIPIENTS[e.type] ?? { kind: 'derived', who: e.audience },
    settingsHref: RULES_PAGE,
  }))

/** Everything the hub sends, in one list. */
export const OUTBOUND: OutboundMessage[] = [...SCHEDULED_MESSAGES, ...INSTANT_MESSAGES]

export function byModule(list: OutboundMessage[] = OUTBOUND): Array<{ module: string; messages: OutboundMessage[] }> {
  const m = new Map<string, OutboundMessage[]>()
  for (const o of list) { const arr = m.get(o.module); if (arr) arr.push(o); else m.set(o.module, [o]) }
  return [...m.entries()].map(([module, messages]) => ({ module, messages })).sort((a, b) => a.module.localeCompare(b.module))
}

/** Every app_settings key the recipients screen may read or write. The save
 *  action refuses anything outside this list. */
export function recipientSettingKeys(list: OutboundMessage[] = OUTBOUND): string[] {
  const keys = new Set<string>()
  for (const o of list) {
    if (o.recipients.kind === 'addresses') keys.add(o.recipients.settingKey)
    if (o.recipients.kind === 'assignment') { keys.add(o.recipients.settingKey); if (o.recipients.ccKey) keys.add(o.recipients.ccKey) }
    if (o.enabledKey) keys.add(o.enabledKey)
  }
  return [...keys].sort()
}

/** Messages that IGNORE the switches on /admin/notifications. */
export function ignoresTheSwitches(list: OutboundMessage[] = OUTBOUND): OutboundMessage[] {
  return list.filter(o => !o.respectsRules)
}

/** Parse a stored address list into emails, whatever its format. */
export function parseAddresses(raw: string | null | undefined, format: AddressFormat): string[] {
  if (!raw) return []
  if (format === 'json-array') { try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String).map(s => s.trim()).filter(s => s.includes('@')) : [] } catch { return [] } }
  return raw.split(/[,;\s]+/).map(s => s.trim()).filter(s => s.includes('@'))
}

/** Serialise emails back into the format the module's own reader expects. */
export function serialiseAddresses(emails: string[], format: AddressFormat): string {
  const clean = [...new Set(emails.map(s => s.trim().toLowerCase()).filter(s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))]
  return format === 'json-array' ? JSON.stringify(clean) : clean.join(', ')
}

export function parseAssignments(raw: string | null | undefined): Record<string, string[]> {
  if (!raw) return {}
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(o)) if (Array.isArray(v)) out[k] = v.map(String).filter(Boolean)
    return out
  } catch { return {} }
}
