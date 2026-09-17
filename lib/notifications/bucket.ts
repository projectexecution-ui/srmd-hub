// Which half of the bell a notification belongs in.
//
// Aksha, 17 Sep 2026 (N1). The bell was one flat list, so a budget waiting for
// his signature sat between two "budget approved" notices that need nothing
// from anyone. Measured that day: 1,089 of 1,205 notifications unread — and
// `cc_budget_approved`, which is pure news, was 86 unread of 87. Mixing the
// two taught people that the whole bell is noise.
//
// So the panel has two halves:
//
//   ON YOUR DESK       something is waiting for YOU to do
//   JUST SO YOU KNOW   news — it happened, nobody is blocked on you
//
// and the red count on the bell is the FIRST of those only, so the number
// means "work" again rather than "messages since you last cared".
//
// THE DEFAULT IS "DESK", DELIBERATELY. A type nobody has classified lands in
// front of the person rather than behind a second tab. Getting it wrong that
// way is a moment of noise; getting it wrong the other way is missed work, and
// new event types are added here regularly (lib/notification-events.ts lists
// twenty-odd and more arrive). So this file names the NEWS, not the work.

/**
 * Types that are information only. Everything else is treated as needing the
 * reader's action — see the note above about which way to fail.
 *
 * Each of these was checked against what it actually says on 17 Sep 2026:
 * every one is a statement about something already finished, or a scheduled
 * report, with no button to press at the end of it.
 */
export const NEWS_TYPES: ReadonlySet<string> = new Set([
  // "It was approved / it happened" — the work is over.
  'cc_budget_approved',
  'cc_estimate_approved',
  'cc_ws_archived',
  'access_approved',
  'bills_sanction_matched',
  'in4_entered',
  'in4_grn_received',
  // Scheduled reports and round-ups. A digest is a summary of things that
  // already have their own notice if they need one.
  'procurement_digest',
  'cc_engineer_digest',
  'cc_budget_approved_digest',
  'cc_budget_vs_actual_report',
])

/** True when this notification is asking the reader to do something. */
export function isDeskItem(type: string | null | undefined): boolean {
  if (!type) return true
  return !NEWS_TYPES.has(type)
}

export interface Bucketed<T> {
  desk: T[]
  news: T[]
}

/** Split a list in one pass, keeping the order it arrived in. */
export function bucket<T extends { type: string }>(rows: readonly T[]): Bucketed<T> {
  const desk: T[] = []
  const news: T[] = []
  for (const r of rows) (isDeskItem(r.type) ? desk : news).push(r)
  return { desk, news }
}

/** Unread items that are asking for something — what the bell's red count
 *  should say. News is counted separately, on its own tab. */
export function deskUnread<T extends { type: string; is_read: boolean }>(rows: readonly T[]): number {
  return rows.reduce((n, r) => (!r.is_read && isDeskItem(r.type) ? n + 1 : n), 0)
}
