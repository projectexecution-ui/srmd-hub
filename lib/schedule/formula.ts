// Schedule tracker — pure formula + status derivation (no I/O, unit-testable).
// Dates are date-only ISO strings ("YYYY-MM-DD"); callers pass IST "today".

import type { LeadDays, SchedItem, DisplayStatus } from './types'

export const DEFAULT_LEADS: LeadDays = { procurement: 21, approval: 7, drawing: 14 }

function parseISO(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Date.UTC(y, m - 1, dd)
}
export function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
export function addDays(iso: string, days: number): string {
  return toISODate(parseISO(iso) + days * 86400000)
}
/** b − a, in whole days (>0 = b is after a). */
export function daysBetween(aISO: string, bISO: string): number {
  return Math.round((parseISO(bISO) - parseISO(aISO)) / 86400000)
}

export interface Deadlines {
  woBy: string | null
  budgetBy: string | null
  drawingBy: string | null
}
/** Work back from the site-start date to the three upstream deadlines. */
export function workBackDeadlines(planStart: string | null, leads: LeadDays = DEFAULT_LEADS): Deadlines {
  if (!planStart) return { woBy: null, budgetBy: null, drawingBy: null }
  return {
    woBy: addDays(planStart, -leads.procurement),
    budgetBy: addDays(planStart, -(leads.procurement + leads.approval)),
    drawingBy: addDays(planStart, -(leads.procurement + leads.approval + leads.drawing)),
  }
}

/** Linear expected % across the plan window as of today (for behind-detection). */
export function expectedPct(item: Pick<SchedItem, 'plan_start' | 'plan_end'>, todayISO: string): number {
  if (!item.plan_start || !item.plan_end) return 0
  const start = parseISO(item.plan_start), end = parseISO(item.plan_end), now = parseISO(todayISO)
  if (end <= start) return now >= end ? 100 : 0
  if (now <= start) return 0
  if (now >= end) return 100
  return Math.round(((now - start) / (end - start)) * 100)
}

export interface Derived {
  status: DisplayStatus
  woBy: string | null
  behindDays: number   // in-progress items running behind the linear plan
  woLateDays: number   // days past the WO deadline with no WO
}

/**
 * Derive the display status. Priority: on-hold → done → blocked (drawing) →
 * WO overdue / due-soon → behind → in-progress → upcoming.
 * `drawingBlocked` = a linked drawing is overdue/not-GFC and gates the item.
 */
export function deriveStatus(
  item: SchedItem,
  todayISO: string,
  opts: { leads?: LeadDays; drawingBlocked?: boolean; woSoonDays?: number } = {},
): Derived {
  const leads = opts.leads ?? DEFAULT_LEADS
  const { woBy } = workBackDeadlines(item.plan_start, leads)
  const soon = opts.woSoonDays ?? 7
  const base = { woBy, behindDays: 0, woLateDays: 0 }

  if (item.state === 'on_hold') return { ...base, status: 'on_hold' }
  if (item.state === 'done' || item.pct >= 100) return { ...base, status: 'done' }
  if (opts.drawingBlocked && !item.wo_issued) return { ...base, status: 'blocked' }

  if (!item.wo_issued && woBy) {
    const d = daysBetween(todayISO, woBy) // >0 future, <0 past
    if (d < 0) return { ...base, status: 'wo_overdue', woLateDays: -d }
    if (d <= soon) return { ...base, status: 'wo_soon' }
  }

  if (item.state === 'in_progress' || item.pct > 0) {
    const exp = expectedPct(item, todayISO)
    if (exp - item.pct >= 10 && item.plan_start && item.plan_end) {
      const dur = Math.max(1, daysBetween(item.plan_start, item.plan_end))
      return { ...base, status: 'behind', behindDays: Math.round(((exp - item.pct) / 100) * dur) }
    }
    return { ...base, status: 'in_progress' }
  }

  return { ...base, status: 'upcoming' }
}

/** UI label + tone per display status (tones map to the app's chip palette). */
export const STATUS_META: Record<DisplayStatus, { label: string; tone: 'ok' | 'soon' | 'late' | 'calm' }> = {
  done: { label: 'Done', tone: 'calm' },
  in_progress: { label: 'In progress', tone: 'ok' },
  behind: { label: 'Behind', tone: 'late' },
  wo_overdue: { label: 'WO overdue', tone: 'late' },
  wo_soon: { label: 'WO due soon', tone: 'soon' },
  blocked: { label: 'Blocked', tone: 'late' },
  upcoming: { label: 'Upcoming', tone: 'calm' },
  on_hold: { label: 'On hold', tone: 'calm' },
}

/** Progress % from the floor matrix: done ÷ applicable (NA excluded); wip counts half. */
export function progressFromFloors(statuses: Array<'not_started' | 'wip' | 'done' | 'na'>): number {
  const applicable = statuses.filter(s => s !== 'na')
  if (!applicable.length) return 0
  const score = applicable.reduce((s, st) => s + (st === 'done' ? 1 : st === 'wip' ? 0.5 : 0), 0)
  return Math.round((score / applicable.length) * 100)
}
