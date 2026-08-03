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

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
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
  const candidates = [full_name, name].map(s => (s ?? '').trim()).filter(Boolean)
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
