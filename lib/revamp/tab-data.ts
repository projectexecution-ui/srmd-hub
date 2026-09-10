// Per-project loaders for the cockpit's tabs.
//
// Every one of these tables already carries `project_id` — which is the finding
// that made the revamp presentation work rather than a data rebuild. So a tab
// is a filtered read, not a new pipeline.

import { createClient } from '@/lib/supabase/server'
import { getMyUser } from '@/lib/auth'
import { matchSubProjects, clean, type HubProject } from './subproject-match'
import { PROJECT_ALIASES } from './alias-seed'
import { descendantIds } from './hierarchy'
import { compareDisciplines } from '@/lib/cost-control/discipline-order'

// ── Approvals ───────────────────────────────────────────────────────────────

/** Anywhere in the 3-stage sign-off chain = still waiting on somebody. Same
 *  set as lib/cost-control/project-rollup.ts; kept in step with it. */
const PENDING = ['submitted', 'ph_approved', 'atm_approved'] as const

/** Which desk a status is sitting on, in the words people use. */
const WAITING_ON: Record<string, string> = {
  submitted: 'Project Head',
  ph_approved: 'Atm Head',
  atm_approved: 'Trustee',
}

export interface PendingApproval {
  id: string
  wsCode: string | null
  category: string
  subSkill: string
  amount: number
  waitingOn: string
  submittedAt: string | null
}

export async function loadProjectApprovals(projectId: string): Promise<PendingApproval[]> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('cc_ws_with_versions')
    .select('id, ws_code, status, total_amount, submitted_at, discipline_id, sub_skill_id, cc_disciplines(name), cc_sub_skills(name)')
    .eq('project_id', projectId)
    .is('archived_at', null)
    .in('status', PENDING as unknown as string[])
    .order('submitted_at', { ascending: true })

  const one = (v: unknown): string =>
    Array.isArray(v) ? ((v[0] as { name?: string })?.name ?? '') : ((v as { name?: string } | null)?.name ?? '')

  return ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
    id: r.id as string,
    wsCode: (r.ws_code as string | null) ?? null,
    category: one(r.cc_disciplines) || '—',
    subSkill: one(r.cc_sub_skills) || '—',
    amount: Number(r.total_amount ?? 0),
    waitingOn: WAITING_ON[r.status as string] ?? 'Someone',
    submittedAt: (r.submitted_at as string | null) ?? null,
  }))
}

// ── Sub-project names ───────────────────────────────────────────────────────
// Kept for the Indents tree and its tests after the upload-based loader left (10 Sep 2026).

export function subProjectOfLine(line: Record<string, unknown>): string {
  const raw = clean(String(line.subProject ?? ''))
  const project = clean(String(line.project ?? ''))
  if (!raw) return ''
  if (project && raw.toLowerCase().startsWith(project.toLowerCase() + ' - ')) {
    return clean(raw.slice(project.length + 3))
  }
  return raw
}

/**
 * The Indent → PO tracker holds its snapshot keyed by IN4's project name —
 * there is no project_id anywhere in it — so the figures are found by matching
 * the name, using the SAME alias list as the Contractor/Supplier reports.
 *
 * Two rows exist in that table: `global` is the main indent tracker and covers
 * every project; `po` is a separate purchase-order report covering one. Reading
 * "the most recently updated row" picks up `po` and makes 22 projects look
 * empty — so `global` is asked for by name.
 */

// ── Discussions ─────────────────────────────────────────────────────────────

export interface ProjectComment {
  id: string
  body: string
  author: string
  createdAt: string
  wsId: string
  wsCode: string | null
  /** True when this comment @-mentions the person reading it. That is the
   *  actionable part of a thread, and today it is only discoverable by opening
   *  each sheet in turn. */
  mentionsMe: boolean
}

export interface ProjectDiscussions {
  comments: ProjectComment[]
  /** Active users, so @mentions render highlighted rather than as plain text —
   *  the same list the per-sheet CommentsPanel passes to MentionText. */
  mentionUsers: Array<{ id: string; name: string }>
  mentioningMe: number
}

/** Every comment written on any of this project's budget sheets, newest first.
 *  Today's comments live per-sheet, so nobody can see the conversation for a
 *  project as a whole — this is that view. */
export async function loadProjectDiscussions(
  projectId: string,
  /** includeInternal: the reader is a Cost Control reviewer, so comments on the
   *  [IB…] Internal Estimate baseline sheets may be shown. Default off — the
   *  baseline is management-confidential and a comment can quote its figures
   *  (go-live audit H4, 10 Sep 2026). */
  opts: { includeInternal?: boolean } = {},
): Promise<ProjectDiscussions> {
  const supabase = await createClient()
  const empty: ProjectDiscussions = { comments: [], mentionUsers: [], mentioningMe: 0 }

  const { data: sheets } = await supabase
    .from('cc_working_sheets').select('id, ws_code, summary_notes').eq('project_id', projectId)
  const all = (sheets ?? []) as Array<{ id: string; ws_code: string | null; summary_notes: string | null }>
  const rows = all.filter(r => opts.includeInternal || !(r.summary_notes ?? '').startsWith('[IB'))
  if (rows.length === 0) return empty

  const codeById = new Map(rows.map(r => [r.id, r.ws_code]))

  // Active users serve two purposes: rendering @mentions highlighted, and
  // knowing which name belongs to the reader. Same list the per-sheet
  // CommentsPanel uses, so a mention looks identical in both places.
  const [{ data: comments }, { data: activeUsers }, me] = await Promise.all([
    supabase.from('cc_ws_comments')
      .select('id, ws_id, author_id, body, created_at')
      .in('ws_id', rows.map(r => r.id))
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('profiles').select('id, full_name, name, email').eq('is_active', true).limit(500),
    getMyUser(),
  ])

  const nameOf = (p: Record<string, unknown>) =>
    (p.full_name as string) || (p.name as string) || (p.email as string) || 'Someone'

  const users = (activeUsers ?? []) as Array<Record<string, unknown>>
  const mentionUsers = users.map(p => ({ id: p.id as string, name: nameOf(p) }))
  const names = new Map(users.map(p => [p.id as string, nameOf(p)]))
  const myName = me ? names.get(me.id) ?? null : null

  const list = (comments ?? []) as Array<Record<string, unknown>>
  const out: ProjectComment[] = list.map(c => {
    const body = String(c.body ?? '')
    return {
      id: c.id as string,
      body,
      author: names.get(c.author_id as string) ?? 'Someone',
      createdAt: c.created_at as string,
      wsId: c.ws_id as string,
      wsCode: codeById.get(c.ws_id as string) ?? null,
      mentionsMe: !!myName && body.includes('@' + myName),
    }
  })

  return {
    comments: out,
    mentionUsers,
    mentioningMe: out.filter(c => c.mentionsMe).length,
  }
}
