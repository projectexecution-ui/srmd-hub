// Everything the approval cards need, loaded once.
//
// This was the body of /cost-control/approvals. It moved here so the project
// workspace's Approvals tab can show the SAME cards with the SAME numbers
// rather than a second implementation that slowly tells a different story —
// which is exactly what happened to the dashboard, whose lighter grouped list
// grew separately from this one.
//
// The only difference between the two callers is `projectId`: absent, this is
// the cross-project "My Approvals" inbox; present, it is one project's queue.
//
// Nothing here decides what is VISIBLE. It returns both the full pending list
// and the "waiting on me" subset, and the caller picks — because "Waiting on
// me" and "All pending" are two views of one load, not two queries.

import type { SupabaseClient } from '@supabase/supabase-js'
import { isWaitingOnMe, type MyApprovalContext } from '@/lib/cost-control/my-approvals'
import { computeMoneyRollup, type RollupWSRow, type RollupVersionRow } from '@/lib/cost-control/project-rollup'
import type { CcSettings } from '@/lib/cost-control/settings'

export interface PRow { code: string; name: string; built_up_sft: number | null; parent_project_id: string | null }
export interface DRow { code: string; name: string }
export interface SRow { code: string; name: string }

export interface WSRow {
  id: string
  ws_code: string
  status: string
  total_amount: number
  approved_for_erp_amt: number | null
  submitted_at: string | null
  engineer_id: string
  discipline_id: string
  sub_skill_id: string | null
  project_id: string
  chain_anchor_id: string | null
  version_no: number | null
  entry_mode: string | null
  summary_notes: string | null
  projects: PRow | PRow[] | null
  cc_disciplines: DRow | DRow[] | null
  cc_sub_skills: SRow | SRow[] | null
}

interface BudgetLineRow {
  project_id: string
  discipline_id: string | null
  sub_skill_id: string | null
  current_budget_amt: number | null
  current_wo_committed_amt: number | null
  current_paid_amt: number | null
}

/** A live sheet used to compute "approved so far": the rollup needs the sheet
 *  fields and its version-chain fields, plus the project it belongs to. */
interface RollupSheetRow extends RollupWSRow, RollupVersionRow { project_id: string }

/**
 * The full-picture extras per sheet: ₹/sft on the estimate, the ERP
 * Budget·WO·Paid strip for this (discipline, sub-skill), and how this ask
 * compares with the previous revision. Each piece hides itself when its data
 * or its settings toggle is absent.
 */
export interface WSEnrichment {
  perSftEst: string | null
  erp: {
    budget: number; wo: number; paid: number
    budgetPerSft: string | null; paidPerSft: string | null
    woPct: number | null; paidPct: number | null
  } | null
  /** ERP columns are on, but this (project, discipline, sub-skill) has no
   *  BPH-synced budget line yet → this ask would be a brand-new ERP budget. */
  erpNew: boolean
  prev: { total: number; ver: number; deltaPct: number | null } | null
}

export interface ApprovalsInbox {
  /** Every pending sheet in scope, oldest submission first. */
  rows: WSRow[]
  /** The subset waiting on THIS person — the same rule the notification count
   *  uses, because both go through isWaitingOnMe(). */
  mine: WSRow[]
  enrich: Map<string, WSEnrichment>
  /** Approved-so-far, keyed `${project}::${discipline}` and
   *  `${project}::${discipline}::${sub_skill}`. */
  approvedByDisc: Map<string, number>
  approvedBySub: Map<string, number>
  erpBudgetByProject: Map<string, number>
  parentMap: Map<string, { code: string; name: string }>
  /** False when the approved-so-far read failed — the cards then omit those
   *  lines rather than printing a zero that looks like a real figure. */
  haveApproved: boolean
  ctx: MyApprovalContext
  error: string | null
}

export function pickFirst<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

/** Whole days a sheet has been waiting since it was submitted. */
export function daysWaiting(submittedAt: string | null): number {
  if (!submittedAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86400000))
}

/** What a pending sheet ADDS to "approved" once fully signed off: its ask
 *  minus whatever has already been released on its chain. */
export function increment(r: WSRow): number {
  return Math.max(0, Number(r.total_amount ?? 0) - Number(r.approved_for_erp_amt ?? 0))
}

export function pendingValue(list: WSRow[]): number {
  return list.reduce((a, r) => a + increment(r), 0)
}

/** Group sheets by project, biggest pending value first. */
export function groupByProject(visible: WSRow[]): { byProject: Map<string, WSRow[]>; projOrder: string[] } {
  const byProject = new Map<string, WSRow[]>()
  const projOrder: string[] = []
  for (const r of visible) {
    const a = byProject.get(r.project_id)
    if (a) a.push(r); else { byProject.set(r.project_id, [r]); projOrder.push(r.project_id) }
  }
  projOrder.sort((a, b) => pendingValue(byProject.get(b) ?? []) - pendingValue(byProject.get(a) ?? []))
  return { byProject, projOrder }
}

/** Group one project's sheets by sub-discipline, preserving arrival order. */
export function groupByDiscipline(items: WSRow[]): { byDisc: Map<string, WSRow[]>; discOrder: string[] } {
  const byDisc = new Map<string, WSRow[]>()
  const discOrder: string[] = []
  for (const r of items) {
    const a = byDisc.get(r.discipline_id)
    if (a) a.push(r); else { byDisc.set(r.discipline_id, [r]); discOrder.push(r.discipline_id) }
  }
  return { byDisc, discOrder }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type SB = SupabaseClient<any, any, any>

export async function loadApprovalsInbox(
  supabase: SB,
  opts: { userId: string | null; ccSettings: CcSettings; projectId?: string },
): Promise<ApprovalsInbox> {
  const { userId, ccSettings, projectId } = opts

  const empty = (error: string | null): ApprovalsInbox => ({
    rows: [], mine: [], enrich: new Map(), approvedByDisc: new Map(), approvedBySub: new Map(),
    erpBudgetByProject: new Map(), parentMap: new Map(), haveApproved: false,
    ctx: { isAdmin: false, effectiveRole: null, myDisciplineIds: new Set(), myNamedCover: new Set(), projectRolesWithNamedApprover: new Set() },
    error,
  })

  // Every stage of the 3-step chain stays pending until fully released. Read
  // from the versioned view so each sheet carries chain_anchor_id / version_no
  // (for the "vs last revision" flag) alongside its money.
  let q = supabase
    .from('cc_ws_with_versions')
    .select(
      `id, ws_code, status, total_amount, approved_for_erp_amt, submitted_at, engineer_id, discipline_id, sub_skill_id, project_id, chain_anchor_id, version_no, entry_mode, summary_notes,
       projects(code, name, built_up_sft, parent_project_id),
       cc_disciplines(code, name),
       cc_sub_skills(code, name)`,
    )
    .in('status', ['submitted', 'ph_approved', 'atm_approved', 'partially_approved'])
    .is('archived_at', null)
  if (projectId) q = q.eq('project_id', projectId)
  const { data: pendingWS, error: wsErr } = await q.order('submitted_at', { ascending: true })

  const rows = (pendingWS ?? []) as unknown as WSRow[]
  const pendingProjectIds = [...new Set(rows.map(r => r.project_id))]

  // Parent ("main") project names, so a sub-project card can read
  // "Main Project › Sub Project". Only projects that actually have a parent.
  const parentIds = [
    ...new Set(rows.map(r => pickFirst(r.projects)?.parent_project_id).filter((v): v is string => !!v)),
  ]
  const { data: parentRows } = parentIds.length
    ? await supabase.from('projects').select('id, code, name').in('id', parentIds)
    : { data: [] as Array<{ id: string; code: string; name: string }> }
  const parentMap = new Map(
    (parentRows ?? []).map(p => [p.id as string, { code: p.code as string, name: p.name as string }]),
  )

  // Only revisions (v2+) have a "previous" to compare against.
  const revAnchors = [
    ...new Set(rows.filter(r => Number(r.version_no ?? 1) > 1 && r.chain_anchor_id).map(r => r.chain_anchor_id as string)),
  ]

  // Everything needed to answer "is this waiting on ME?" — my effective role,
  // the disciplines I head, and the named-approver map for these projects.
  const [{ data: prof }, { data: eff }, { data: myDisc, error: discErr }, { data: approvers, error: apprErr }, { data: budgetLines }, { data: priorVersions }] =
    await Promise.all([
      supabase.from('profiles').select('role').eq('id', userId ?? '').maybeSingle(),
      supabase.rpc('effective_user_role', { p_user_id: userId ?? '', p_module_slug: 'cost-control' }),
      supabase.from('cc_discipline_approvers').select('discipline_id').eq('approver_user_id', userId ?? '').eq('is_active', true),
      pendingProjectIds.length
        ? supabase.from('cc_project_approvers').select('project_id, role, user_id').in('project_id', pendingProjectIds)
        : Promise.resolve({ data: [] as Array<{ project_id: string; role: string; user_id: string }>, error: null }),
      pendingProjectIds.length
        ? supabase.from('cc_budget_lines').select('project_id, discipline_id, sub_skill_id, current_budget_amt, current_wo_committed_amt, current_paid_amt').in('project_id', pendingProjectIds)
        : Promise.resolve({ data: [] as BudgetLineRow[], error: null }),
      revAnchors.length
        ? supabase.from('cc_ws_with_versions').select('chain_anchor_id, version_no, total_amount').in('chain_anchor_id', revAnchors)
        : Promise.resolve({ data: [] as Array<{ chain_anchor_id: string | null; version_no: number | null; total_amount: number | null }>, error: null }),
    ])

  const queryErr = wsErr ?? discErr ?? apprErr
  if (queryErr) return empty(queryErr.message)

  const blMap = new Map<string, { budget: number; wo: number; paid: number }>()
  const erpBudgetByProject = new Map<string, number>()
  for (const b of (budgetLines ?? []) as BudgetLineRow[]) {
    const k = `${b.project_id}::${b.discipline_id}::${b.sub_skill_id ?? '_root'}`
    const cur = blMap.get(k) ?? { budget: 0, wo: 0, paid: 0 }
    cur.budget += Number(b.current_budget_amt ?? 0)
    cur.wo += Number(b.current_wo_committed_amt ?? 0)
    cur.paid += Number(b.current_paid_amt ?? 0)
    blMap.set(k, cur)
    // Whole-project ERP budget (every line, all disciplines) — the base figure
    // management tracks against, shown as the project card headline.
    erpBudgetByProject.set(b.project_id, (erpBudgetByProject.get(b.project_id) ?? 0) + Number(b.current_budget_amt ?? 0))
  }

  const chainVers = new Map<string, Array<{ ver: number; total: number }>>()
  for (const v of (priorVersions ?? []) as Array<{ chain_anchor_id: string | null; version_no: number | null; total_amount: number | null }>) {
    if (!v.chain_anchor_id) continue
    const arr = chainVers.get(v.chain_anchor_id) ?? []
    arr.push({ ver: Number(v.version_no ?? 1), total: Number(v.total_amount ?? 0) })
    chainVers.set(v.chain_anchor_id, arr)
  }

  const perSft = (amt: number, sft: number): string | null =>
    ccSettings.show_per_sft && sft > 0 && amt > 0
      ? `₹${Math.round(amt / sft).toLocaleString('en-IN')}/sft`
      : null

  const enrich = new Map<string, WSEnrichment>()
  for (const ws of rows) {
    const sft = Number(pickFirst(ws.projects)?.built_up_sft ?? 0)
    const est = Number(ws.total_amount ?? 0)

    const bl = ws.sub_skill_id ? blMap.get(`${ws.project_id}::${ws.discipline_id}::${ws.sub_skill_id}`) : undefined
    const erp = ccSettings.show_erp_columns && bl && (bl.budget !== 0 || bl.wo !== 0 || bl.paid !== 0)
      ? {
          budget: bl.budget, wo: bl.wo, paid: bl.paid,
          budgetPerSft: perSft(bl.budget, sft),
          paidPerSft: perSft(bl.paid, sft),
          woPct: bl.budget > 0 ? Math.round((bl.wo / bl.budget) * 100) : null,
          paidPct: bl.budget > 0 ? Math.round((bl.paid / bl.budget) * 100) : null,
        }
      : null

    let prev: WSEnrichment['prev'] = null
    const ver = Number(ws.version_no ?? 1)
    if (ws.chain_anchor_id && ver > 1) {
      const earlier = (chainVers.get(ws.chain_anchor_id) ?? []).filter(v => v.ver < ver).sort((a, b) => b.ver - a.ver)
      if (earlier.length) {
        const p = earlier[0]
        prev = { total: p.total, ver: p.ver, deltaPct: p.total > 0 ? Math.round(((est - p.total) / p.total) * 100) : null }
      }
    }

    enrich.set(ws.id, { perSftEst: perSft(est, sft), erp, erpNew: ccSettings.show_erp_columns && !erp, prev })
  }

  const approverRows = (approvers ?? []) as Array<{ project_id: string; role: string; user_id: string }>
  const ctx: MyApprovalContext = {
    isAdmin: (prof?.role as string | null) === 'admin',
    effectiveRole: (eff as string | null) ?? (prof?.role as string | null) ?? null,
    myDisciplineIds: new Set((myDisc ?? []).map(d => d.discipline_id as string)),
    myNamedCover: new Set(approverRows.filter(a => a.user_id === userId).map(a => `${a.project_id}:${a.role}`)),
    projectRolesWithNamedApprover: new Set(approverRows.map(a => `${a.project_id}:${a.role}`)),
  }

  // ── "Before" = budgets already signed off, per (project, discipline) and
  // per (project, discipline, sub-skill). Reuses the Internal-Estimate money
  // rollup so these figures match the project page to the rupee. ──
  const { data: allSheetRows, error: allErr } = pendingProjectIds.length
    ? await supabase
        .from('cc_ws_with_versions')
        .select('id, project_id, discipline_id, sub_skill_id, status, total_amount, approved_for_erp_amt, summary_notes, entry_mode, chain_anchor_id, version_no')
        .in('project_id', pendingProjectIds)
    : { data: [] as RollupSheetRow[], error: null }

  const approvedByDisc = new Map<string, number>()
  const approvedBySub = new Map<string, number>()
  {
    const byProj = new Map<string, RollupSheetRow[]>()
    for (const s of (allSheetRows ?? []) as RollupSheetRow[]) {
      const a = byProj.get(s.project_id)
      if (a) a.push(s); else byProj.set(s.project_id, [s])
    }
    for (const [pid, sheets] of byProj) {
      const roll = computeMoneyRollup({ wsRows: sheets, versionRows: sheets, budgetLines: [], subSkills: [], disciplines: [] })
      // wsAgg is keyed `${discipline}::${sub_skill}` within a project.
      for (const [key, agg] of roll.wsAgg) {
        const disc = key.slice(0, key.indexOf('::'))
        approvedByDisc.set(`${pid}::${disc}`, (approvedByDisc.get(`${pid}::${disc}`) ?? 0) + agg.approvedTotal)
        approvedBySub.set(`${pid}::${key}`, (approvedBySub.get(`${pid}::${key}`) ?? 0) + agg.approvedTotal)
      }
    }
  }

  return {
    rows,
    mine: rows.filter(r => isWaitingOnMe(r, ctx)),
    enrich,
    approvedByDisc,
    approvedBySub,
    erpBudgetByProject,
    parentMap,
    haveApproved: !allErr,
    ctx,
    error: null,
  }
}
