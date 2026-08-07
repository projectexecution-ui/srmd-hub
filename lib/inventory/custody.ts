// Pure helpers for the "Site stock check" (custody tally). No Supabase/React.
//
// Model: a site's book balance for an item = net sent = issued − returned.
//   • Consumables (is_returnable=false): what's counted ("actual") is normally
//     LESS than sent — the gap is legitimate consumption ("used to date").
//   • Returnables (is_returnable=true): the item should still be there, so a
//     shortfall (actual < expected) means MISSING and is flagged.
//   • Either kind showing MORE on site than was ever sent = phantom / untracked
//     stock and is flagged.

import { istDateStr, istShiftDate } from '@/lib/inventory/day-window'

export interface CustodyPrefillItem {
  itemId: string
  code: string
  name: string
  category: string | null
  unit: string
  isReturnable: boolean
  expected: number          // net sent to site (issued − returned)
  lastActual: number | null // what was counted last time (carry-forward), null if never
}

export interface CheckLineResult {
  itemId: string
  name: string
  isReturnable: boolean
  expected: number
  actual: number
}

export type VarianceKind = 'ok' | 'used' | 'missing' | 'phantom'

// Interpret one counted line for display / flagging.
export function classifyLine(expected: number, actual: number, isReturnable: boolean): {
  kind: VarianceKind
  usedToDate: number   // sent − onsite, floored at 0 (consumables)
  shortfall: number    // expected − onsite, when returnable & short
  phantom: number      // onsite − sent, when more than sent
} {
  const usedToDate = Math.max(expected - actual, 0)
  const shortfall = Math.max(expected - actual, 0)
  const phantom = Math.max(actual - expected, 0)
  let kind: VarianceKind = 'ok'
  if (actual > expected) kind = 'phantom'
  else if (isReturnable && actual < expected) kind = 'missing'
  else if (!isReturnable && actual < expected) kind = 'used'
  return { kind, usedToDate, shortfall, phantom }
}

// Is a counted line a variance management should see?
export function isVariance(expected: number, actual: number, isReturnable: boolean): boolean {
  const k = classifyLine(expected, actual, isReturnable).kind
  return k === 'missing' || k === 'phantom'
}

// IST Monday (start of week) for a given IST date string (defaults to today).
// Monday-based so a week reads Mon–Sun; returned as YYYY-MM-DD.
export function weekStartIST(istDate: string = istDateStr()): string {
  // Day-of-week from a UTC-noon anchor of the IST date to avoid tz drift.
  const dow = new Date(`${istDate}T12:00:00Z`).getUTCDay() // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7                        // Mon→0, Sun→6
  return istShiftDate(istDate, -backToMonday)
}

// A human week label, e.g. "Mon 4 Aug – Sun 10 Aug".
export function weekLabel(weekStart: string): string {
  const end = istShiftDate(weekStart, 6)
  const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  })
  return `${fmt(weekStart)} – ${fmt(end)}`
}

// Has this project been checked during the current IST week?
export function isCheckedThisWeek(lastCheckWeekStart: string | null): boolean {
  return !!lastCheckWeekStart && lastCheckWeekStart === weekStartIST()
}
