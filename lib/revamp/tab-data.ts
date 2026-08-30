// Per-project loaders for the cockpit's tabs.
//
// Every one of these tables already carries `project_id` — which is the finding
// that made the revamp presentation work rather than a data rebuild. So a tab
// is a filtered read, not a new pipeline.

import { createClient } from '@/lib/supabase/server'

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
  /** The project name the latest upload actually covers. */
  uploadedFor: string | null
  /** True when that upload is this project. */
  isThisProject: boolean
  totalLines: number
  pendingLines: number
  pendingValue: number
  poValue: number
  grnValue: number
}

/**
 * The Indent → PO tracker keeps ONE uploaded snapshot at a time, keyed by
 * IN4's project name — there is no project_id anywhere in it. So this reports
 * honestly: the figures when the snapshot is this project, and otherwise which
 * project it does cover, rather than a misleading row of zeros.
 */
export async function loadProjectProcurement(
  projectId: string, projectName: string, projectCode: string | null,
): Promise<ProjectProcurement> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('procurement_tracker_state').select('state')
    .order('updated_at', { ascending: false }).limit(1).maybeSingle()

  const projects = ((data?.state as { projects?: unknown })?.projects ?? []) as Array<Record<string, unknown>>
  const first = projects[0]
  const uploadedFor = first ? String(first.projectName ?? '') || null : null

  const k = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const isThisProject = !!uploadedFor
    && (k(uploadedFor) === k(projectName) || (!!projectCode && k(uploadedFor) === k(projectCode)))

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

  return {
    uploadedFor,
    isThisProject,
    totalLines: isThisProject ? num(first!.total) : 0,
    pendingLines: isThisProject ? num(first!.pendingLineCount) : 0,
    pendingValue: isThisProject ? num(first!.pendingValue) : 0,
    poValue: isThisProject ? num(first!.totalPoValue) : 0,
    grnValue: isThisProject ? num(first!.totalGrnValue) : 0,
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
}

/** Every comment written on any of this project's budget sheets, newest first.
 *  Today's comments live per-sheet, so nobody can see the conversation for a
 *  project as a whole — this is that view. */
export async function loadProjectDiscussions(projectId: string): Promise<ProjectComment[]> {
  const supabase = await createClient()

  const { data: sheets } = await supabase
    .from('cc_working_sheets').select('id, ws_code').eq('project_id', projectId)
  const rows = (sheets ?? []) as Array<{ id: string; ws_code: string | null }>
  if (rows.length === 0) return []

  const codeById = new Map(rows.map(r => [r.id, r.ws_code]))
  const { data: comments } = await supabase
    .from('cc_ws_comments')
    .select('id, ws_id, author_id, body, created_at')
    .in('ws_id', rows.map(r => r.id))
    .order('created_at', { ascending: false })
    .limit(100)

  const list = (comments ?? []) as Array<Record<string, unknown>>
  const authorIds = [...new Set(list.map(c => c.author_id as string).filter(Boolean))]
  const names = new Map<string, string>()
  if (authorIds.length) {
    const { data: profs } = await supabase
      .from('profiles').select('id, full_name, name, email').in('id', authorIds)
    for (const p of (profs ?? []) as Array<Record<string, unknown>>) {
      names.set(p.id as string,
        (p.full_name as string) || (p.name as string) || (p.email as string) || 'Someone')
    }
  }

  return list.map(c => ({
    id: c.id as string,
    body: String(c.body ?? ''),
    author: names.get(c.author_id as string) ?? 'Someone',
    createdAt: c.created_at as string,
    wsId: c.ws_id as string,
    wsCode: codeById.get(c.ws_id as string) ?? null,
  }))
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
