// Server-side loader for the project cockpit header + Overview.
//
// Money comes from computeMoneyRollup — the SAME function the live Internal
// Estimate page uses. That is deliberate: the cockpit must never invent its own
// arithmetic, or the revamp would show different totals from the page Aksha
// already trusts, and every number would have to be re-argued.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import {
  computeMoneyRollup,
  type RollupWSRow, type RollupVersionRow, type RollupBudgetLine,
} from '@/lib/cost-control/project-rollup'

export interface CockpitProject {
  id: string
  code: string | null
  name: string
  builtUpSft: number | null
  parentName: string | null
  ccStatus: string | null
  setupPct: number
}

export interface CockpitMoney {
  internalEstimate: number
  awaitingApproval: number
  budgetErp: number
  wo: number
  paid: number
  /** Paid ÷ Budget (ERP) as a whole percent; null when there is no budget to
   *  divide by, so the UI can show "—" instead of a misleading 0%. */
  usedPct: number | null
  /** How many approval chains are sitting with somebody right now. */
  awaitingCount: number
}

export interface CockpitData {
  project: CockpitProject
  money: CockpitMoney
  categories: number
  subSkills: number
}

/** Cached per request so the layout (header) and the page (Overview) share one
 *  round trip instead of querying twice on every navigation. */
export const loadCockpit = cache(async (projectId: string): Promise<CockpitData | null> => {
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, code, name, built_up_sft, parent_project_id, cc_status, setup_progress_pct')
    .eq('id', projectId)
    .maybeSingle()

  if (!project) return null

  const [parentRes, discRes, subRes, blRes, wsRes] = await Promise.all([
    project.parent_project_id
      ? supabase.from('projects').select('name').eq('id', project.parent_project_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('cc_project_disciplines').select('discipline_id').eq('project_id', projectId).eq('is_enabled', true),
    supabase.from('cc_project_sub_skills').select('sub_skill_id').eq('project_id', projectId).eq('is_enabled', true),
    supabase.from('cc_budget_lines')
      .select('discipline_id, sub_skill_id, current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', projectId),
    supabase.from('cc_ws_with_versions')
      .select('id, discipline_id, sub_skill_id, engineer_id, status, total_amount, approved_for_erp_amt, chain_anchor_id, version_no, summary_notes')
      .eq('project_id', projectId)
      .is('archived_at', null),
  ])

  const disciplines = ((discRes.data ?? []) as Array<{ discipline_id: string }>)
    .map(d => ({ id: d.discipline_id }))
  const subSkillRows = (subRes.data ?? []) as Array<{ sub_skill_id: string }>

  // computeMoneyRollup wants sub-skills carrying their discipline. The enabled
  // list does not, so map them through the budget lines + sheets that do.
  const discBySub = new Map<string, string>()
  for (const b of (blRes.data ?? []) as RollupBudgetLine[]) {
    if (b.sub_skill_id && b.discipline_id) discBySub.set(b.sub_skill_id, b.discipline_id)
  }
  for (const w of (wsRes.data ?? []) as RollupWSRow[]) {
    if (w.sub_skill_id && w.discipline_id) discBySub.set(w.sub_skill_id, w.discipline_id)
  }
  const subSkills = subSkillRows
    .map(s => ({ id: s.sub_skill_id, discipline_id: discBySub.get(s.sub_skill_id) ?? '' }))
    .filter(s => s.discipline_id !== '')

  const rollup = computeMoneyRollup({
    wsRows: (wsRes.data ?? []) as RollupWSRow[],
    versionRows: (wsRes.data ?? []) as unknown as RollupVersionRow[],
    budgetLines: (blRes.data ?? []) as RollupBudgetLine[],
    subSkills,
    disciplines,
  })

  let internalEstimate = 0, awaitingApproval = 0, budgetErp = 0, wo = 0, paid = 0
  for (const d of disciplines) {
    const a = rollup.discAgg.get(d.id)
    if (!a) continue
    internalEstimate += a.estimate
    awaitingApproval += a.pending
    budgetErp += a.budget
    wo += a.wo
    paid += a.paid
  }

  // Count of chains still with an approver — the "waiting on someone" number,
  // which is what the Overview leads with rather than a money total.
  let awaitingCount = 0
  for (const agg of rollup.wsAgg.values()) if (agg.pendingAmount > 0) awaitingCount += 1

  return {
    project: {
      id: project.id as string,
      code: (project.code as string | null) ?? null,
      name: project.name as string,
      builtUpSft: project.built_up_sft != null ? Number(project.built_up_sft) : null,
      parentName: (parentRes.data as { name?: string } | null)?.name ?? null,
      ccStatus: (project.cc_status as string | null) ?? null,
      setupPct: Number(project.setup_progress_pct ?? 0),
    },
    money: {
      internalEstimate, awaitingApproval, budgetErp, wo, paid,
      usedPct: budgetErp > 0 ? Math.round((paid / budgetErp) * 100) : null,
      awaitingCount,
    },
    categories: disciplines.length,
    subSkills: subSkills.length,
  }
})
