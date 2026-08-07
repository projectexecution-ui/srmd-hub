// Sequencing derivation — pure, no I/O. From three plain inputs per item
// ("follows X" + gap days + cycle days-per-floor) derive every floor's plan
// window, the item's overall start/end, and live per-floor readiness.
// No dependency types, no leads/lags vocabulary — floor-to-floor chaining
// produces the overlapping "takt train" naturally.

import { addDays } from './formula'
import type { SchedItem, FloorStatus } from './types'

export const DEFAULT_CYCLE_DAYS = 7

export interface FloorWindow { start: string; end: string }
export interface DerivedPlan {
  start: string | null            // first floor's start (or stored plan_start)
  end: string | null              // last floor's end (or stored plan_end)
  floors: Record<string, FloorWindow>
  derived: boolean                // true when computed from the chain/cycle
}

type CellFn = (itemId: string, floor: string) => FloorStatus

/** Derive plan windows for every item. Anchors need a stored plan_start;
 *  followers chain per floor: start(f) = pred(f).end + gap, and a crew never
 *  starts a floor before finishing its previous one (takt continuity). */
export function deriveSchedule(
  items: SchedItem[],
  floorNames: string[],
  cellOf: CellFn,
): Map<string, DerivedPlan> {
  const byId = new Map(items.map(i => [i.id, i]))
  const memo = new Map<string, DerivedPlan>()
  const visiting = new Set<string>()

  const applicableFloors = (it: SchedItem) => floorNames.filter(f => cellOf(it.id, f) !== 'na')

  function resolve(id: string): DerivedPlan {
    const hit = memo.get(id)
    if (hit) return hit
    const it = byId.get(id)
    if (!it) return { start: null, end: null, floors: {}, derived: false }
    if (visiting.has(id)) {
      // circular "follows" — fall back to stored dates, never loop
      const flat = { start: it.plan_start, end: it.plan_end, floors: {}, derived: false }
      memo.set(id, flat)
      return flat
    }
    visiting.add(id)

    const floors = applicableFloors(it)
    const cycle = it.cycle_days ?? (it.follows_item_id ? DEFAULT_CYCLE_DAYS : null)
    let plan: DerivedPlan

    if (it.follows_item_id && byId.has(it.follows_item_id)) {
      const pred = resolve(it.follows_item_id)
      const win: Record<string, FloorWindow> = {}
      let prevEnd: string | null = null
      for (const f of floors) {
        const base = pred.floors[f]?.end ?? pred.end
        if (!base) continue
        let start = addDays(base, it.gap_days)
        if (prevEnd && prevEnd > start) start = prevEnd     // crew continuity
        const end = addDays(start, cycle ?? DEFAULT_CYCLE_DAYS)
        win[f] = { start, end }
        prevEnd = end
      }
      const keys = floors.filter(f => win[f])
      plan = keys.length
        ? { start: win[keys[0]].start, end: win[keys[keys.length - 1]].end, floors: win, derived: true }
        : { start: it.plan_start, end: it.plan_end, floors: {}, derived: false }
    } else if (it.plan_start && cycle && floors.length) {
      // anchor with a cycle: floors ladder out from the start date
      const win: Record<string, FloorWindow> = {}
      floors.forEach((f, i) => {
        const start = addDays(it.plan_start!, i * cycle)
        win[f] = { start, end: addDays(start, cycle) }
      })
      plan = { start: it.plan_start, end: win[floors[floors.length - 1]].end, floors: win, derived: true }
    } else {
      plan = { start: it.plan_start, end: it.plan_end, floors: {}, derived: false }
    }

    visiting.delete(id)
    memo.set(id, plan)
    return plan
  }

  for (const it of items) resolve(it.id)
  return memo
}

export interface FloorReadiness {
  item: SchedItem
  floor: string
  readyFrom: string   // predecessor done date + gap
  predName: string
}

/** Floors whose predecessor is DONE (gap elapsed by `today`) and whose own
 *  cell hasn't started — the live "ready to start" list. */
export function readyFloors(
  items: SchedItem[],
  floorNames: string[],
  cellOf: CellFn,
  doneAt: (itemId: string, floor: string) => string | null,
  today: string,
): FloorReadiness[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const out: FloorReadiness[] = []
  for (const it of items) {
    if (!it.follows_item_id) continue
    const pred = byId.get(it.follows_item_id)
    if (!pred) continue
    for (const f of floorNames) {
      if (cellOf(it.id, f) !== 'not_started') continue
      if (cellOf(pred.id, f) !== 'done') continue
      const done = doneAt(pred.id, f)
      if (!done) continue
      const readyFrom = addDays(done.slice(0, 10), it.gap_days)
      if (readyFrom <= today) out.push({ item: it, floor: f, readyFrom, predName: pred.name })
    }
  }
  return out.sort((a, b) => a.readyFrom.localeCompare(b.readyFrom))
}

/** Actual pace (days per floor) from the dates floors were ticked done.
 *  Needs ticks on at least two different days to mean anything. */
export function actualCycleDays(doneDates: string[]): number | null {
  const days = Array.from(new Set(doneDates.map(d => d.slice(0, 10)))).sort()
  if (days.length < 2) return null
  const diffs: number[] = []
  for (let i = 1; i < days.length; i++) {
    const ms = Date.parse(days[i]) - Date.parse(days[i - 1])
    diffs.push(Math.round(ms / 86400000))
  }
  diffs.sort((a, b) => a - b)
  return diffs[Math.floor(diffs.length / 2)]
}
