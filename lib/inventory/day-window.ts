import { APP_TIME_ZONE } from '@/lib/utils'

// Movement reporting works in IST calendar days even though the DB stores UTC.
// IST is a fixed UTC+05:30 (no DST), so an IST date maps cleanly to a UTC range.

// 'YYYY-MM-DD' for the given instant, in IST.
export function istDateStr(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE })
}

// Shift an IST date string by whole days (e.g. -1 = yesterday).
export function istShiftDate(istDate: string, days: number): string {
  const base = new Date(`${istDate}T00:00:00+05:30`)
  return istDateStr(new Date(base.getTime() + days * 86_400_000))
}

// The UTC [start, end) instants covering one IST calendar day, plus a display label.
export function istDayRange(istDate: string): { startUtc: string; endUtc: string; label: string } {
  const start = new Date(`${istDate}T00:00:00+05:30`)
  const end = new Date(start.getTime() + 86_400_000)
  const label = start.toLocaleDateString('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: APP_TIME_ZONE,
  })
  return { startUtc: start.toISOString(), endUtc: end.toISOString(), label }
}
