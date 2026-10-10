// Server loader for the budget shifting tracker (see transfer-tracker.ts).
//
// The viewer is checked FIRST with their own session — Admin, the Coordinator
// (Parimal) and Atm Heads only — and only then are the names read with the
// service key: "who has it now" needs the Atm Heads named on each project and
// who holds the Trustee / Billing roles, which ordinary row security does not
// let a Coordinator read. Which requests an Atm Head may follow is decided in
// buildTransferTracker (his projects, unassigned ones, and what he raised or
// signed). Read-only: nothing here writes.

import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyProfile } from '@/lib/auth'
import {
  buildTransferTracker, OPEN_TRANSFER_STATUSES,
  type TrackerRow, type TrackerTransfer, type TrackerPerson,
} from './transfer-tracker'

export interface TransferTrackerResult {
  /** The viewer is one of the people this tracker is for. */
  allowed: boolean
  rows: TrackerRow[]
  error?: string
}

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))]

export async function loadTransferTracker(opts: { projectId?: string } = {}): Promise<TransferTrackerResult> {
  const [user, profile] = await Promise.all([getMyUser(), getMyProfile()])
  if (!user) return { allowed: false, rows: [] }
  const supabase = await createClient()
  const { data: eff } = await supabase.rpc('effective_user_role', { p_user_id: user.id, p_module_slug: 'cost-control' })
  const role = ((eff as string | null) ?? profile?.role ?? null) as string | null
  const isAdmin = profile?.role === 'admin'
  if (!(isAdmin || role === 'coordinator' || role === 'head')) return { allowed: false, rows: [] }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { allowed: true, rows: [], error: 'The server cannot read the budget shifting requests right now.' }
  const svc = createServiceClient(url, key, { auth: { persistSession: false } })

  let q = svc
    .from('cc_budget_transfers')
    .select('id, project_id, status, amount, reason, from_discipline_id, from_sub_skill_id, to_discipline_id, to_sub_skill_id, raised_by, raised_at, ph_by, ph_at, atm_by, atm_at, trustee_by, trustee_at, in4_at, settle_note')
    .in('status', [...OPEN_TRANSFER_STATUSES])
  if (opts.projectId) q = q.eq('project_id', opts.projectId)
  const { data: transfers, error } = await q
  if (error) return { allowed: true, rows: [], error: error.message }
  if (!transfers || transfers.length === 0) return { allowed: true, rows: [] }

  const ts = transfers as TrackerTransfer[]
  const projIds = uniq(ts.map(t => t.project_id))
  const discIds = uniq(ts.flatMap(t => [t.from_discipline_id, t.to_discipline_id]))
  const subIds = uniq(ts.flatMap(t => [t.from_sub_skill_id, t.to_sub_skill_id]))

  const [projects, approvers, profiles, overrides, discs, subs, inbox] = await Promise.all([
    svc.from('projects').select('id, code, name').in('id', projIds),
    svc.from('cc_project_approvers').select('project_id, user_id, role').in('project_id', projIds).in('role', ['project_head', 'head', 'founder']),
    svc.from('profiles').select('id, full_name, name, email, role, is_active'),
    svc.from('user_module_roles').select('user_id, role').eq('module_slug', 'cost-control'),
    svc.from('cc_disciplines').select('id, code, name').in('id', discIds),
    svc.from('cc_sub_skills').select('id, code, name').in('id', subIds),
    // What the viewer may approve now — the same rule the approve call uses.
    supabase.rpc('cc_transfer_inbox'),
  ])
  const firstError = [projects, approvers, profiles, overrides, discs, subs].find(r => r.error)?.error
  if (firstError) return { allowed: true, rows: [], error: firstError.message }

  const override = new Map(((overrides.data ?? []) as { user_id: string; role: string }[]).map(o => [o.user_id, o.role]))
  const people: TrackerPerson[] = ((profiles.data ?? []) as {
    id: string; full_name: string | null; name: string | null; email: string | null; role: string | null; is_active: boolean | null
  }[]).map(p => ({
    id: p.id,
    name: p.full_name || p.name || p.email || 'Someone',
    role: override.get(p.id) ?? p.role,
    active: p.is_active !== false,
  }))

  const rows = buildTransferTracker({
    transfers: ts,
    projects: (projects.data ?? []) as { id: string; code: string | null; name: string | null }[],
    approvers: (approvers.data ?? []) as { project_id: string; user_id: string; role: string }[],
    people,
    disciplines: (discs.data ?? []) as { id: string; code: string | null; name: string | null }[],
    subSkills: (subs.data ?? []) as { id: string; code: string | null; name: string | null }[],
    viewer: { id: user.id, role, isAdmin },
    myApprovalIds: new Set(((inbox.data ?? []) as { id: string }[]).map(r => r.id)),
    now: Date.now(),
  })
  return { allowed: true, rows }
}
