// The Today strip on the Admin home — what is wrong right now, in words.
//
// Aksha's H1 (23 Sep 2026): "Today reads the actual run log: each feed's last
// result, each job's last stamp, in words." The strip used to read only the
// cron heartbeat, which had not been saved since 15 Sep, so it said "a
// scheduled job did not run" every day while the jobs ran — and it never
// looked at the IN4 feed results, where the real failures were (the tracker
// feed failing on every run since 22 Sep).
//
// Pure: the loader (today.server.ts) fetches, this decides and words.

import { formatDateTime } from '@/lib/utils'
import type { HealthFinding } from '@/lib/revamp/admin-health'

export interface FeedState {
  feed: string
  label: string
  startedAt: string
  /** true ran, false failed, null started and never finished. */
  ok: boolean | null
  error: string | null
}

export interface TodayInput {
  nowMs: number
  pendingAccess: number
  pendingDeletes: number
  /** The newest run of each feed. */
  feeds: FeedState[]
  /** cron_ledger: job key → IST date it last succeeded. */
  ledger: Record<string, string> | null
  findings: HealthFinding[]
}

export interface TodayRow {
  id: string
  tone: 'bad' | 'warn' | 'info'
  text: string
  href: string
  action: string
}

/** A run that began this long ago and has no result is stuck, not in progress. */
export const UNFINISHED_AFTER_MS = 30 * 60_000
/** A ledger older than this means jobs are running unrecorded (or not at all). */
export const LEDGER_STALE_AFTER_MS = 2 * 24 * 3_600_000

/** Old fix links from the health checks, moved to their door. */
const MOVED: Record<string, string> = {
  '/admin/reports': '/admin/messages?tab=scheduled',
  '/admin/permissions': '/admin/people?tab=roles',
  '/admin/notifications': '/admin/messages?tab=alerts',
}

function shortError(e: string | null): string {
  if (!e) return 'no error was recorded'
  const s = e.replace(/\s+/g, ' ').trim()
  return s.length > 90 ? s.slice(0, 87) + '…' : s
}

export function todayRows(i: TodayInput): TodayRow[] {
  const out: TodayRow[] = []

  if (i.pendingAccess > 0) {
    out.push({
      id: 'access', tone: 'warn', href: '/admin/people?tab=accounts', action: 'Approve',
      text: i.pendingAccess === 1 ? '1 person is waiting for access to the hub.' : `${i.pendingAccess} people are waiting for access to the hub.`,
    })
  }
  if (i.pendingDeletes > 0) {
    out.push({
      id: 'deletes', tone: 'warn', href: '/admin/data?tab=deleted', action: 'Decide',
      text: i.pendingDeletes === 1 ? '1 deletion needs a second pair of eyes.' : `${i.pendingDeletes} deletions need a second pair of eyes.`,
    })
  }

  for (const f of i.feeds) {
    if (f.ok === false) {
      out.push({
        id: `feed-${f.feed}`, tone: 'bad', href: '/admin/data?tab=in4', action: 'Open IN4',
        text: `The ${f.label} feed failed at ${formatDateTime(f.startedAt)} — ${shortError(f.error)}.`,
      })
    } else if (f.ok === null && i.nowMs - Date.parse(f.startedAt) > UNFINISHED_AFTER_MS) {
      out.push({
        id: `feed-${f.feed}`, tone: 'warn', href: '/admin/data?tab=in4', action: 'Open IN4',
        text: `The ${f.label} feed started at ${formatDateTime(f.startedAt)} and never finished.`,
      })
    }
  }

  const stamps = Object.values(i.ledger ?? {}).map(d => Date.parse(`${d}T00:00:00+05:30`)).filter(n => !Number.isNaN(n))
  if (stamps.length === 0) {
    out.push({
      id: 'ledger', tone: 'info', href: '/admin/messages?tab=health', action: 'Job health',
      text: 'The scheduled-jobs record has never been saved, so Admin cannot tell which jobs ran.',
    })
  } else {
    const newest = Math.max(...stamps)
    if (i.nowMs - newest > LEDGER_STALE_AFTER_MS) {
      const when = new Date(newest).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
      out.push({
        id: 'ledger', tone: 'warn', href: '/admin/messages?tab=health', action: 'Job health',
        text: `The scheduled-jobs record was last saved on ${when} — jobs are running unrecorded, so a daily digest can go out twice.`,
      })
    }
  }

  for (const f of i.findings) {
    out.push({
      id: f.id,
      tone: f.severity === 'blocker' ? 'bad' : f.severity === 'warn' ? 'warn' : 'info',
      text: `${f.title}. ${f.detail}`,
      href: MOVED[f.href] ?? f.href,
      action: f.fixLabel,
    })
  }

  const order = { bad: 0, warn: 1, info: 2 }
  return out.sort((a, b) => order[a.tone] - order[b.tone])
}
