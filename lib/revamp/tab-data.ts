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
import type { LineRecord } from '@/lib/procurement'

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

// ── Stores ──────────────────────────────────────────────────────────────────

export interface ProjectStores {
  /** Stores whose owner is this project. Empty = it draws from shared stores. */
  ownStores: Array<{ id: string; code: string | null; name: string; items: number }>
  requests: Array<{ id: string; reqNo: string | null; status: string; purpose: string | null; date: string | null }>
}

export async function loadProjectStores(projectId: string): Promise<ProjectStores> {
  const supabase = await createClient()
  const [locRes, reqRes] = await Promise.all([
    supabase.from('wh_locations').select('id, code, name').eq('project_id', projectId).is('deleted_at', null),
    supabase.from('wh_requests')
      .select('id, req_no, status, purpose, request_date')
      .eq('project_id', projectId).is('deleted_at', null)
      .order('request_date', { ascending: false }).limit(25),
  ])

  const locs = (locRes.data ?? []) as Array<{ id: string; code: string | null; name: string }>
  let counts = new Map<string, number>()
  if (locs.length) {
    const { data: stock } = await supabase
      .from('wh_stock').select('location_id').in('location_id', locs.map(l => l.id))
    counts = (stock ?? []).reduce((m, s) => {
      const k = s.location_id as string
      return m.set(k, (m.get(k) ?? 0) + 1)
    }, new Map<string, number>())
  }

  return {
    ownStores: locs.map(l => ({ ...l, items: counts.get(l.id) ?? 0 })),
    requests: ((reqRes.data ?? []) as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string,
      reqNo: (r.req_no as string | null) ?? null,
      status: r.status as string,
      purpose: (r.purpose as string | null) ?? null,
      date: (r.request_date as string | null) ?? null,
    })),
  }
}

// ── Indent → PO ─────────────────────────────────────────────────────────────

export interface ProjectProcurement {
  /** The IN4 sub-project name(s) these figures came from. */
  matchedName: string | null
  /** How many projects the upload covers, for context when we found none. */
  uploadCovers: number
  /** Names in the upload that match no project in the hub. */
  unmatchedNames: string[]
  totalLines: number
  pendingLines: number
  pendingValue: number
  poValue: number
  grnValue: number
  /** The lines themselves, grouped by discipline — a summary alone is not
   *  something anyone can act on. */
  byDiscipline: ProcurementGroup[]
  /** The same lines untouched, so the cockpit can hand them to the tracker's
   *  OWN views (Pending receipts / Needs PO / Completed) rather than
   *  re-implementing chase notes, ageing and drill-down a second time. The
   *  stored JSON already IS LineRecord — it is what the parser wrote. */
  lines: LineRecord[]
}

export interface ProcurementGroup {
  discipline: string
  lines: ProcurementLine[]
  pendingValue: number
  grnValue: number
}

export interface ProcurementLine {
  id: string
  indentNo: string
  indentDate: string | null
  ageDays: number
  material: string
  supplier: string
  uom: string
  indentQty: number
  orderedQty: number
  receivedQty: number
  pendingQty: number
  pendingValue: number
  grnValue: number
  status: string
  poNos: string[]
}

/**
 * Every indent line carries `subProject`, written as
 * "<Project> - <SubProject>" — e.g.
 *   "New Guest House - New Guest House B-Execution"
 *   "P2 Stepped Terraces - P2 Stepped Terraces - Execution A-01"
 *
 * Strip the leading project name and what is left is the SAME sub-project
 * string the contractor/supplier reports use, so the one matcher handles both.
 * The project name repeats inside, so only the first occurrence is removed.
 */
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
export async function loadProjectProcurement(projectId: string): Promise<ProjectProcurement> {
  const supabase = await createClient()
  const [{ data: rows }, { data: projRows }] = await Promise.all([
    supabase.from('procurement_tracker_state').select('id, state'),
    supabase.from('projects').select('id, code, name, parent_project_id').is('archived_at', null),
  ])

  const list = (rows ?? []) as Array<{ id: string; state: unknown }>
  const state = (list.find(r => r.id === 'global') ?? list[0])?.state
  const uploaded = ((state as { projects?: unknown })?.projects ?? []) as Array<Record<string, unknown>>

  const raw = (projRows ?? []) as Array<Record<string, unknown>>
  const hub = raw as unknown as HubProject[]
  const covered = new Set(descendantIds(
    raw.map(p => ({ id: p.id as string, parentId: (p.parent_project_id as string | null) ?? null })),
    projectId,
  ))

  // Work from the LINES, not the project totals. IN4 records an indent against
  // "New Guest House" as a whole, so the project-level figures cannot tell NGH A
  // from NGH B — but every LINE carries its own subProject, which does. That is
  // what lets a tower show its own indents instead of the group's.
  const lines: Array<Record<string, unknown>> = []
  for (const proj of uploaded) {
    for (const ln of (Array.isArray(proj.lines) ? proj.lines : []) as Array<Record<string, unknown>>) {
      lines.push(ln)
    }
  }

  // Match every distinct sub-project once, then keep the lines whose
  // sub-project resolved to this project or anything under it.
  const subNames = [...new Set(lines.map(subProjectOfLine).filter(Boolean))]
  const subMatches = matchSubProjects(subNames, hub, PROJECT_ALIASES)
  const mineSubs = new Set(
    subMatches.filter(m => m.projectId && covered.has(m.projectId)).map(m => m.subProjectName),
  )
  const mineLines = lines.filter(l => mineSubs.has(subProjectOfLine(l)))

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

  // PO value has no line-level total — it is the sum of each PO's qty × rate.
  let poValue = 0
  for (const l of mineLines) {
    for (const po of (Array.isArray(l.pos) ? l.pos : []) as Array<Record<string, unknown>>) {
      poValue += num(po.qty) * num(po.rate)
    }
  }

  // Group the lines by discipline, the same shape the Internal Estimate uses:
  // a category row you can collapse, with its rows underneath. Pending work
  // sorts to the top of each group, because that is what needs chasing.
  const groups = new Map<string, ProcurementLine[]>()
  for (const l of mineLines) {
    const disc = clean(String(l.discipline ?? '')) || '—'
    const line: ProcurementLine = {
      id: String(l.id ?? ''),
      indentNo: String(l.indentNo ?? ''),
      indentDate: (l.indentDate as string | null) ?? null,
      ageDays: num(l.indentAgeDays),
      material: clean(String(l.material ?? '')),
      supplier: clean(String(l.supplier ?? '')),
      uom: String(l.uom ?? ''),
      indentQty: num(l.indentQty),
      orderedQty: num(l.orderedQty),
      receivedQty: num(l.receivedQty),
      pendingQty: num(l.pendingQty),
      pendingValue: num(l.pendingValue),
      grnValue: num(l.grnValue),
      status: String(l.status ?? ''),
      poNos: ((Array.isArray(l.pos) ? l.pos : []) as Array<Record<string, unknown>>)
        .map(po => String(po.poNo ?? '')).filter(Boolean),
    }
    const list = groups.get(disc)
    if (list) list.push(line); else groups.set(disc, [line])
  }

  const byDiscipline: ProcurementGroup[] = [...groups.entries()]
    .map(([discipline, list]) => ({
      discipline,
      lines: list.sort((a, b) =>
        (b.pendingValue - a.pendingValue) || (b.pendingQty - a.pendingQty) || (b.ageDays - a.ageDays)),
      pendingValue: list.reduce((s, l) => s + l.pendingValue, 0),
      grnValue: list.reduce((s, l) => s + l.grnValue, 0),
    }))
    // Same rule as everywhere else in the hub: by the discipline's code number.
    .sort((a, b) => compareDisciplines(
      { code: a.discipline, display_order: null },
      { code: b.discipline, display_order: null },
    ))

  return {
    matchedName: mineLines.length ? [...mineSubs].sort().join(', ') : null,
    uploadCovers: uploaded.length,
    // Only meaningful when we found nothing: which sub-projects went unclaimed.
    unmatchedNames: mineLines.length
      ? []
      : subMatches.filter(m => !m.projectId).map(m => m.subProjectName),
    totalLines: mineLines.length,
    pendingLines: mineLines.filter(l => num(l.pendingQty) > 0).length,
    pendingValue: mineLines.reduce((s, l) => s + num(l.pendingValue), 0),
    poValue,
    grnValue: mineLines.reduce((s, l) => s + num(l.grnValue), 0),
    byDiscipline,
    lines: mineLines as unknown as LineRecord[],
  }
}

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
export async function loadProjectDiscussions(projectId: string): Promise<ProjectDiscussions> {
  const supabase = await createClient()
  const empty: ProjectDiscussions = { comments: [], mentionUsers: [], mentioningMe: 0 }

  const { data: sheets } = await supabase
    .from('cc_working_sheets').select('id, ws_code').eq('project_id', projectId)
  const rows = (sheets ?? []) as Array<{ id: string; ws_code: string | null }>
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

// ── JMR ─────────────────────────────────────────────────────────────────────

export interface ProjectJmr {
  entries: number
  pending: number
  totalAmount: number
  lastEntry: string | null
  recent: Array<{ id: string; date: string | null; qty: number; amount: number; status: string; description: string | null }>
}

export async function loadProjectJmr(projectId: string): Promise<ProjectJmr> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('jmr_daily_entries')
    .select('id, entry_date, quantity, amount, status, work_description')
    .eq('project_id', projectId)
    .order('entry_date', { ascending: false })

  const rows = (data ?? []) as Array<Record<string, unknown>>
  return {
    entries: rows.length,
    pending: rows.filter(r => r.status !== 'approved').length,
    totalAmount: rows.reduce((s, r) => s + Number(r.amount ?? 0), 0),
    lastEntry: (rows[0]?.entry_date as string | null) ?? null,
    recent: rows.slice(0, 20).map(r => ({
      id: r.id as string,
      date: (r.entry_date as string | null) ?? null,
      qty: Number(r.quantity ?? 0),
      amount: Number(r.amount ?? 0),
      status: r.status as string,
      description: (r.work_description as string | null) ?? null,
    })),
  }
}
