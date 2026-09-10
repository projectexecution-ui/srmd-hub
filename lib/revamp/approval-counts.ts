// "How many approvals are waiting on ME", per project.
//
// Aksha, 7 Sept 2026: the yellow pending-approvals count should show on the
// sidebar's project rows and on the workspace ribbon's Approvals tab, "of
// respective roles" — so each person sees their own queue, not the project's.
//
// It reads `my_approval_inbox()`, the SAME function the dashboard's "Needs you
// now" and the notification count already use. That is deliberate and it is
// what the build order asks for in §4: "Waiting on me must use the same rule as
// the notification count — one shared function, so the two can never disagree."
// The RPC is security definer and scoped to auth.uid(), so the role filtering
// happens in the database and this file never re-implements it.
//
// One RPC per request, deduplicated by React cache: the sidebar and the ribbon
// both ask for it while rendering the same page, and they get one round trip.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export interface ApprovalCounts {
  /** project id → items waiting on this person, for that project alone. */
  byProject: Record<string, number>
  /** Everything waiting on them, across every module and project. */
  total: number
  /** Just the Cost Control budgets — what the Approvals tab actually lists. */
  costControl: number
}

export const EMPTY_COUNTS: ApprovalCounts = { byProject: {}, total: 0, costControl: 0 }

interface InboxRow { module_slug: string | null; project_id: string | null }

export function tallyInbox(rows: InboxRow[]): ApprovalCounts {
  const byProject: Record<string, number> = {}
  let costControl = 0
  for (const r of rows) {
    if (r.project_id) byProject[r.project_id] = (byProject[r.project_id] ?? 0) + 1
    if (r.module_slug === 'cost-control') costControl++
  }
  return { byProject, total: rows.length, costControl }
}

/**
 * A parent project shows its children's queue as well as its own.
 *
 * Without this a collapsed group reads as having nothing waiting while three
 * of its buildings each have budgets on your desk — the count would be telling
 * you the opposite of the truth at exactly the moment it is collapsed. One
 * level of nesting, which is all the sidebar tree renders.
 */
export function rollUpCounts(
  byProject: Record<string, number>,
  projects: Array<{ id: string; parentId: string | null }>,
): Record<string, number> {
  const out: Record<string, number> = { ...byProject }
  for (const p of projects) {
    if (!p.parentId) continue
    const own = byProject[p.id] ?? 0
    if (own > 0) out[p.parentId] = (out[p.parentId] ?? 0) + own
  }
  return out
}

/** Waiting-on-me counts for the signed-in person. Never throws: a badge is
 *  decoration, and a failed count must not take a page down. */
export const getMyApprovalCounts = cache(async (): Promise<ApprovalCounts> => {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('my_approval_inbox')
    if (error) return EMPTY_COUNTS
    return tallyInbox((data ?? []) as InboxRow[])
  } catch {
    return EMPTY_COUNTS
  }
})
