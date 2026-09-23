// The Budget landing for a PARENT project (NGH, P2, VV).
//
// A grouping anchor holds no disciplines of its own — the money lives in its
// children (NGH A / B / C / Infra / Common Expenses). Opening it used to show
// the empty Internal Estimate ("No disciplines enabled"), which read as broken.
//
// Instead the parent's Budget tab rolls up its sub-projects: the same five
// headline figures the leaf shows, summed across the children, and one
// collapsed row per sub-project that opens into that project's own workspace.
//
// Money comes from loadCockpit — the SAME computeMoneyRollup the live Internal
// Estimate page uses — so the group total is the sum of figures Aksha already
// trusts, never a second calculation. The summation itself is a pure function
// so it can be unit-tested away from Supabase.

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { projectChip } from '@/lib/names'
import { loadCockpit, type CockpitMoney } from './project-cockpit'

export interface GroupChild {
  id: string
  code: string | null
  /** projects.short_name → code (name layer, Phase 1). */
  chip: string | null
  name: string
  ccStatus: string | null
  builtUpSft: number | null
  setupPct: number
  money: CockpitMoney
}

export interface GroupTotal extends CockpitMoney {
  builtUpSft: number | null
}

export interface GroupBudget {
  children: GroupChild[]
  total: GroupTotal
}

const EMPTY_MONEY: CockpitMoney = {
  internalEstimate: 0, awaitingApproval: 0, budgetErp: 0, wo: 0, paid: 0, usedPct: null, awaitingCount: 0,
}

/**
 * Sum the children into the group total. Pure — the % is derived the same way
 * the leaf derives it (paid ÷ ERP budget, null when there is no budget to
 * divide by), and area is null unless at least one child has one, so the header
 * shows "—" rather than a misleading 0.
 */
export function rollupGroupTotal(children: GroupChild[]): GroupTotal {
  let internalEstimate = 0, awaitingApproval = 0, budgetErp = 0, wo = 0, paid = 0, awaitingCount = 0, sft = 0
  let anySft = false
  for (const c of children) {
    internalEstimate += c.money.internalEstimate
    awaitingApproval += c.money.awaitingApproval
    budgetErp += c.money.budgetErp
    wo += c.money.wo
    paid += c.money.paid
    awaitingCount += c.money.awaitingCount
    if (c.builtUpSft != null) { sft += c.builtUpSft; anySft = true }
  }
  return {
    internalEstimate, awaitingApproval, budgetErp, wo, paid, awaitingCount,
    usedPct: budgetErp > 0 ? Math.round((paid / budgetErp) * 100) : null,
    builtUpSft: anySft ? sft : null,
  }
}

/** a + b, with the % re-derived — never averaged. */
export function addMoney(a: CockpitMoney, b: CockpitMoney): CockpitMoney {
  const budgetErp = a.budgetErp + b.budgetErp
  const paid = a.paid + b.paid
  return {
    internalEstimate: a.internalEstimate + b.internalEstimate,
    awaitingApproval: a.awaitingApproval + b.awaitingApproval,
    budgetErp, wo: a.wo + b.wo, paid,
    usedPct: budgetErp > 0 ? Math.round((paid / budgetErp) * 100) : null,
    awaitingCount: a.awaitingCount + b.awaitingCount,
  }
}

/** Direct children of a parent, each with its money roll-up, plus the group
 *  total. Since 23 Sep 2026 (Aksha, H1) the tree is three levels deep — a
 *  project under a group may hold sub-projects — so a child's figure is its
 *  own money PLUS everything under it, by recursion. Cached per request. */
export const loadGroupBudget = cache(async (parentId: string): Promise<GroupBudget> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('projects')
    .select('id, code, short_name, name, cc_status, built_up_sft, setup_progress_pct')
    .eq('parent_project_id', parentId)
    .is('archived_at', null)
    .order('code', { ascending: true })
    .order('name', { ascending: true })

  const kids = (data ?? []) as Array<{
    id: string; code: string | null; short_name: string | null; name: string
    cc_status: string | null; built_up_sft: number | null; setup_progress_pct: number | null
  }>

  const children: GroupChild[] = await Promise.all(kids.map(async k => {
    const [c, below] = await Promise.all([loadCockpit(k.id), loadGroupBudget(k.id)])
    const own = c?.money ?? EMPTY_MONEY
    return {
      id: k.id,
      code: k.code ?? null,
      chip: projectChip(k.short_name, k.code) || null,
      name: k.name,
      ccStatus: k.cc_status ?? null,
      builtUpSft: k.built_up_sft != null ? Number(k.built_up_sft) : below.total.builtUpSft,
      setupPct: Number(k.setup_progress_pct ?? 0),
      money: below.children.length > 0 ? addMoney(own, below.total) : own,
    }
  }))

  return { children, total: rollupGroupTotal(children) }
})
