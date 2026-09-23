// Who sees what on the home page — pure, so it can be tested against real
// role data instead of discovered on a real screen (the warehouse lesson).
//
// Aksha, 23 Sep 2026, about the "Waiting to be verified in IN4" card: "all are
// getting confused … only Atm head specific … only Atms level they should
// know." The card used to render for everyone whose project tree carried the
// project — engineers, viewers, admins — although the only person who can do
// anything about a document at Verify in IN4 is that project's Atm Head.

import type { VerifyPortfolio } from '@/lib/revamp/verify-counts'
import type { VerifyRow } from '@/components/dashboard/VerifyInIn4'
import type { InboxItem } from '@/components/dashboard/NeedsYouNow'

export interface ScopedProject { id: string; code: string | null; name: string }

/** The Verify rows for THIS reader: only projects where they hold the `head`
 *  chair (cc_project_approvers.role = 'head' — the Atm Head), and only those
 *  the shell already lets them open. Everyone else gets nothing, and the
 *  "at Verify on no sub-project" line is for heads only as well: it is IN4
 *  work, and nobody but an Atm Head clears IN4 work. */
export function verifyRowsFor(
  portfolio: Pick<VerifyPortfolio, 'byProject' | 'unassigned'>,
  headProjectIds: ReadonlySet<string>,
  projects: readonly ScopedProject[],
): { rows: VerifyRow[]; unassigned: VerifyPortfolio['unassigned']; isHead: boolean } {
  const isHead = headProjectIds.size > 0
  const none = { indents: 0, wos: 0, pos: 0 }
  if (!isHead) return { rows: [], unassigned: none, isHead }
  const visible = new Map(projects.map(p => [p.id, p]))
  const rows: VerifyRow[] = Object.entries(portfolio.byProject)
    .filter(([projectId]) => headProjectIds.has(projectId) && visible.has(projectId))
    .map(([projectId, c]) => {
      const p = visible.get(projectId)!
      return { projectId, label: p.code ?? p.name, indents: c.indents, wos: c.wos, pos: c.pos }
    })
    .filter(r => r.indents + r.wos + r.pos > 0)
    .sort((a, b) => (b.indents + b.wos + b.pos) - (a.indents + a.wos + a.pos) || a.label.localeCompare(b.label))
  return { rows, unassigned: portfolio.unassigned, isHead }
}

/** Live "waiting on you" count per module tile, from the same inbox that
 *  feeds "Needs you now" — so a tile and the list can never disagree. */
export function tileBadges(inbox: readonly Pick<InboxItem, 'module_slug'>[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const i of inbox) out[i.module_slug] = (out[i.module_slug] ?? 0) + 1
  return out
}

export interface ModuleGroup<T> { slug: string; items: T[] }

/** Non-budget inbox items grouped by module, largest group first, order of
 *  arrival kept inside a group. Named groups, not one flat wall. */
export function groupByModule<T extends Pick<InboxItem, 'module_slug'>>(items: readonly T[]): ModuleGroup<T>[] {
  const by = new Map<string, T[]>()
  for (const it of items) {
    const list = by.get(it.module_slug)
    if (list) list.push(it); else by.set(it.module_slug, [it])
  }
  return [...by.entries()]
    .map(([slug, list]) => ({ slug, items: list }))
    .sort((a, b) => b.items.length - a.items.length || a.slug.localeCompare(b.slug))
}

/** "Morning / Afternoon / Evening" by the IST clock. The server runs on UTC,
 *  so `new Date().getHours()` said "Good Morning" until 17:30 IST. */
export function istGreeting(nowMs = Date.now()): 'Morning' | 'Afternoon' | 'Evening' {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date(nowMs)))
  return hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening'
}
