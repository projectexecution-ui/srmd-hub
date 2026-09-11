// Server side of the Monday report: the IN4 tree, re-shaped by the config,
// with the week-over-week baseline taken from the PREVIOUS MONDAY'S SEND
// (budget_v2_weekly_snapshot), not from whatever IN4 wrote yesterday.

import { loadBudgetV2 } from '@/lib/budget-v2-load'
import { deltaVs, type ComposeResult, type SnapshotTotals, type DeltaResult } from '@/lib/budget-v2'
import type { BudgetV2Freshness } from '@/lib/budget-v2-load'
import { applyWeeklyConfig, parseWeeklyConfig, mondayOf, WEEKLY_CONFIG_KEY, type WeeklyConfig } from './config'

export interface WeeklyLoaded {
  cfg: WeeklyConfig
  result: ComposeResult
  freshness: BudgetV2Freshness
  delta: DeltaResult
  /** The Monday the baseline was captured on (null = first send, no Δ yet). */
  prevSnapshotWeek: string | null
  /** The baseline's full tree — lets the detail PDFs show Δ per category. */
  prev: ComposeResult | null
  unplaced: string[]
  missing: string[]
  /** IST Monday of the current week — the guard key and the next send date. */
  thisMonday: string
  /** Every IN4 line in the feed with money, for the Admin table. */
  in4Lines: Array<{ name: string; group: string; budget: number; approved: number; spent: number }>
}

interface SnapshotRow { week_ending: string; totals: { snapshot?: SnapshotTotals; tree?: ComposeResult } | null }

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadWeeklyReport(supabase: any, nowMs = Date.now()): Promise<WeeklyLoaded> {
  const [{ data: cfgRow }, base] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', WEEKLY_CONFIG_KEY).maybeSingle(),
    loadBudgetV2(supabase),
  ])
  const cfg = parseWeeklyConfig((cfgRow?.value as string | null) ?? null)
  const applied = applyWeeklyConfig(base.result, cfg)

  // Baseline = the newest saved Monday BEFORE this week's Monday.
  const thisMonday = mondayOf(nowMs)
  const { data: snapRows } = await supabase
    .from('budget_v2_weekly_snapshot').select('week_ending, totals')
    .lt('week_ending', thisMonday).order('week_ending', { ascending: false }).limit(1)
  const snap = ((snapRows ?? []) as SnapshotRow[])[0]
  const prevSnapshot = snap?.totals?.snapshot ?? null
  const prev = snap?.totals?.tree ?? null

  const in4Lines = base.result.groups.flatMap(g => g.projects.map(p => ({ name: p.name, group: g.name, budget: p.budget, approved: p.approved, spent: p.spent })))

  return {
    cfg,
    result: applied.result,
    freshness: base.freshness,
    delta: deltaVs(applied.result, prevSnapshot),
    prevSnapshotWeek: prevSnapshot ? snap.week_ending : null,
    prev,
    unplaced: applied.unplaced,
    missing: applied.missing,
    thisMonday,
    in4Lines,
  }
}
