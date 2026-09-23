// The Admin console's rail and ribbon — the pure part.
//
// Aksha, 23 Sep 2026 (Admin Home Directions): B · Console — "the five doors
// are a left rail with counts; the right pane shows the selected door's
// tabs and rows without leaving the page. Today is a thin ribbon across the
// top." With pieces P1 (a live count and a status dot on every door) and P2
// (the Today strip folds to one line).
//
// Every badge is decided here from plain counts, so the words and the colours
// are tested and the loader (rail.server.ts) only fetches.

import type { DoorId } from './doors'
import type { TodayRow } from './today'

export type Tone = 'none' | 'ok' | 'warn' | 'bad'

export interface RailCounts {
  people: number
  pendingAccess: number
  projects: number
  projectsNeedHead: number
  scheduled: number
  messagesSilent: number
  feeds: number
  feedsFailing: number
  feedsUnfinished: number
  intakeWaiting: number
  modulesOn: number
  modulesTotal: number
}

export interface RailBadge { text: string; tone: Tone }

const s = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** One badge per door: what is wrong if anything is, else what is there. */
export function railBadge(door: DoorId, c: RailCounts): RailBadge {
  switch (door) {
    case 'people':
      return c.pendingAccess > 0
        ? { text: `${c.pendingAccess} waiting`, tone: 'warn' }
        : { text: s(c.people, 'person', 'people'), tone: 'none' }
    case 'projects':
      return c.projectsNeedHead > 0
        ? { text: s(c.projectsNeedHead, 'needs a head', 'need a head'), tone: 'warn' }
        : { text: s(c.projects, 'project', 'projects'), tone: 'none' }
    case 'messages':
      return c.messagesSilent > 0
        ? { text: `${c.messagesSilent} reach nobody`, tone: 'bad' }
        : { text: `${c.scheduled} scheduled`, tone: 'none' }
    case 'data':
      if (c.feedsFailing > 0) return { text: s(c.feedsFailing, 'feed failing', 'feeds failing'), tone: 'bad' }
      if (c.feedsUnfinished > 0) return { text: s(c.feedsUnfinished, 'feed unfinished', 'feeds unfinished'), tone: 'warn' }
      if (c.intakeWaiting > 0) return { text: `${c.intakeWaiting} waiting from IN4`, tone: 'none' }
      return { text: `${c.feeds} feeds ok`, tone: 'ok' }
    case 'hub':
      return { text: `${c.modulesOn} / ${c.modulesTotal} on`, tone: 'none' }
  }
}

export interface FoldedToday {
  count: number
  tone: Tone
  /** "3 things need you · tracker feed failed · 20 RU projects have no Atm Head · jobs ledger stale" */
  line: string
}

/** The one-line version of the Today strip (P2). The first three rows,
 *  shortened to their first clause; the worst tone colours the ribbon. */
export function foldToday(rows: readonly TodayRow[]): FoldedToday {
  if (rows.length === 0) return { count: 0, tone: 'ok', line: 'Nothing needs you today.' }
  const tone: Tone = rows.some(r => r.tone === 'bad') ? 'bad' : rows.some(r => r.tone === 'warn') ? 'warn' : 'none'
  const clause = (t: string) => {
    const first = t.split(/ — |\. /)[0].replace(/\.$/, '')
    return first.length > 64 ? first.slice(0, 61).trimEnd() + '…' : first
  }
  const head = `${rows.length} ${rows.length === 1 ? 'thing needs' : 'things need'} you`
  const names = rows.slice(0, 3).map(r => clause(r.text))
  const more = rows.length > 3 ? ` · +${rows.length - 3} more` : ''
  return { count: rows.length, tone, line: `${head} · ${names.join(' · ')}${more}` }
}
