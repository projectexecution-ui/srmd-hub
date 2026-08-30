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
