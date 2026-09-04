import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Standard India time zone for ALL date/time display across the app. The DB
// stores timestamps in UTC; the server runs in UTC too, so without pinning
// this every server-rendered time (audit trails, emails, pages) would show
// ~5.5h behind actual IST. Always format dates through the helpers below (or
// pass this constant to Intl) — never call toLocale*/DateTimeFormat on a date
// without it.
export const APP_TIME_ZONE = 'Asia/Kolkata'

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '--'
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE,
  })
}

/** Today's calendar date in IST as 'YYYY-MM-DD'. The server runs in UTC, so
 *  `new Date().toISOString().slice(0, 10)` is YESTERDAY between midnight and
 *  05:30 IST — every "today" for a deadline, a default date field or a
 *  date-keyed query must go through this. */
export function todayIST(nowMs: number = Date.now()): string {
  return new Date(nowMs + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

/** A Date (or ISO string) as its IST calendar date 'YYYY-MM-DD'. */
export function istDateKey(date: string | Date): string {
  const t = typeof date === 'string' ? Date.parse(date) : date.getTime()
  return todayIST(t)
}

export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '--'
  return new Date(date).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: APP_TIME_ZONE,
  })
}

// No paise. Construction BOQs / budgets / approvals deal in whole rupees;
// trailing ".00" was just noise that made columns feel cluttered. If a
// non-integer ever sneaks in (rare — usually a stray ÷ result), Intl
// rounds half-to-even, same as Math.round.
const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export function formatINR(n: number | string | null | undefined): string {
  const v = typeof n === 'string' ? Number(n) : n
  // !Number.isFinite rejects NaN and ±Infinity (Intl would render "₹∞").
  if (v === null || v === undefined || !Number.isFinite(v as number)) return '—'
  return INR.format(v as number)
}

export function formatNumber(n: number | string | null | undefined, decimals = 2): string {
  const v = typeof n === 'string' ? Number(n) : n
  if (v === null || v === undefined || !Number.isFinite(v as number)) return '—'
  return (v as number).toLocaleString('en-IN', {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  })
}

export function indentStageColor(stage: string): 'default' | 'success' | 'warning' | 'secondary' {
  switch (stage) {
    case 'approved': return 'success'
    case 'verify': return 'warning'
    case 'submitted': return 'default'
    case 'draft':
    default: return 'secondary'
  }
}

export function indentStageLabel(stage: string): string {
  switch (stage) {
    case 'draft': return 'Draft'
    case 'submitted': return 'Submitted'
    case 'verify': return 'In Verification'
    case 'approved': return 'Approved'
    default: return stage
  }
}

/** Today in IST as 'YYYY-MM-DD'. Used to be the UTC date, which is yesterday
 *  between midnight and 05:30 IST — every deadline check and default date
 *  field that used it was a day behind first thing in the morning. */
export function todayISO(): string {
  return todayIST()
}

/** Best display name for a person. Profiles in this DB sometimes have
 *  full_name auto-set to the email local-part (e.g. "projectexecution")
 *  while the real name lives in `name` ("Akshay"). Prefer whichever value
 *  is NOT just the email prefix. Falls back to the email local-part. */
export function personName(
  full_name: string | null | undefined,
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const local = email ? email.split('@')[0].trim().toLowerCase() : ''
  // Prefer the editable `name` (what an admin renames on Users & Roles) over the
  // Google-supplied `full_name`, so a rename actually shows everywhere. Both still
  // skip a value that's just the email prefix.
  const candidates = [name, full_name].map(s => (s ?? '').trim()).filter(Boolean)
  const real = candidates.find(c => c.toLowerCase() !== local)
  return real ?? candidates[0] ?? (email ? email.split('@')[0] : '—')
}

/** Human-friendly elapsed time between two instants, e.g. "2d 3h", "7h 43m",
 *  "12m", "<1m". Used for "time taken" between audit-trail steps. */
export function formatDuration(fromISO: string, toISO: string): string {
  const ms = new Date(toISO).getTime() - new Date(fromISO).getTime()
  if (!Number.isFinite(ms) || ms < 0) return ''
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return '<1m'
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** Whole CALENDAR days between a timestamp and now, in IST.
 *
 *  Not the same as dividing elapsed milliseconds by 24 hours, which is what
 *  callers reached for and what produced "uploaded today" for a file uploaded at
 *  3:49 pm the previous afternoon: only ~15 hours had elapsed, so the division
 *  gave 0. A calendar comparison gives 1, which is what a reader means by
 *  "yesterday".
 *
 *  Use this whenever the output is a calendar WORD (today / yesterday). For an
 *  ageing or SLA measure ("waiting 3d") elapsed time is the right semantic and
 *  this is the wrong helper.
 */
export function istCalendarDaysAgo(date: string | Date | null | undefined): number | null {
  if (date == null) return null
  const t = typeof date === 'string' ? Date.parse(date) : date.getTime()
  if (!Number.isFinite(t)) return null
  // en-CA renders as YYYY-MM-DD, so the IST calendar date can be compared as a
  // plain UTC-midnight instant without any local-timezone drift.
  const istDay = (ms: number) =>
    Date.parse(new Date(ms).toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE }) + 'T00:00:00Z')
  return Math.round((istDay(Date.now()) - istDay(t)) / 86_400_000)
}

/** "today" / "yesterday" / "3 d ago" — from IST calendar days, not elapsed ms. */
export function istAgeLabel(
  date: string | Date | null | undefined,
  opts: { short?: boolean } = {},
): { text: string; days: number | null } {
  const days = istCalendarDaysAgo(date)
  if (days == null) return { text: 'unknown', days: null }
  if (days <= 0) return { text: 'today', days }
  if (days === 1) return { text: 'yesterday', days }
  if (days < 7) return { text: opts.short ? `${days} d ago` : `${days} days ago`, days }
  if (days < 30) {
    const w = Math.floor(days / 7)
    return { text: opts.short ? `${w} w ago` : `${w} week${w === 1 ? '' : 's'} ago`, days }
  }
  const m = Math.floor(days / 30)
  return { text: opts.short ? `${m} mo ago` : `${m} month${m === 1 ? '' : 's'} ago`, days }
}
