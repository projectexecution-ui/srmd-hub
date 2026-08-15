// Shared loader for the Budget vs Actual V2 tree. Fetches the BPH (budget) blob
// plus the V2-owned status/area/extra/override tables, then runs the SAME
// composeBudgetV2 engine the page uses. Both the /budget-vs-actual-v2 page AND
// the weekly Telegram report call this, so the report can never drift.
//
// Single source: every uploaded number comes from the budget report itself. On
// top of that, an admin can hand-add projects (extras with numbers) or flag a
// correction (budget_v2_override) — both shown as "manually adjusted".
//
// It also loads the most recent weekly snapshot and returns the week-over-week
// delta (current tree − last snapshot) so the page/report can show what moved.
//
// Accepts any Supabase client (server client on the page, service client in the
// cron) — it only needs `.from(...).select(...)`.

import {
  composeBudgetV2, snapshotOf, deltaVs,
  type StatusMap, type AreaOverrideMap, type ExtraProject, type OverrideMap,
  type ComposeResult, type SnapshotTotals, type DeltaResult,
} from '@/lib/budget-v2'

export interface BudgetV2Freshness {
  budget: string | null
}

export interface BudgetV2LoadResult {
  result: ComposeResult
  freshness: BudgetV2Freshness
  /** week-over-week movement vs the latest weekly snapshot (0s if none yet). */
  delta: DeltaResult
  /** the week_ending of the snapshot the delta compares against (null = none). */
  prevSnapshotWeek: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadBudgetV2(supabase: any): Promise<BudgetV2LoadResult> {
  const [
    { data: bud },
    { data: statusRows },
    { data: areaRows }, { data: extraRows }, { data: overrideRows },
    { data: budHistRows },
    { data: snapRows },
  ] = await Promise.all([
    supabase.from('budget_hub_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('budget_v2_project_status').select('project_name, status'),
    supabase.from('budget_v2_project_area').select('project_name, area_sft'),
    supabase.from('budget_v2_extra_project').select('name, group_name, area_sft, notes, budget, approved, paid'),
    supabase.from('budget_v2_override').select('project_name, budget, approved, paid, note, updated_at'),
    supabase.from('budget_hub_state').select('updated_at').eq('id', 'global').maybeSingle(),
    supabase.from('budget_v2_weekly_snapshot').select('week_ending, totals').order('week_ending', { ascending: false }).limit(1),
  ])

  const budgetProjects = ((bud?.state as any)?.projects ?? []) as any[]

  const statusMap: StatusMap = {}
  for (const r of statusRows ?? []) statusMap[r.project_name] = r.status as 'open' | 'closed'
  const areaOverrides: AreaOverrideMap = {}
  for (const r of areaRows ?? []) if (typeof r.area_sft === 'number') areaOverrides[r.project_name] = r.area_sft
  const extras: ExtraProject[] = (extraRows ?? []).map((r: any) => ({
    name: r.name, group_name: r.group_name, area_sft: r.area_sft,
    budget: r.budget, approved: r.approved, paid: r.paid,
  }))
  const overrides: OverrideMap = {}
  for (const r of overrideRows ?? []) {
    overrides[r.project_name] = { budget: r.budget, approved: r.approved, paid: r.paid, note: r.note, updated_at: r.updated_at }
  }

  const result = composeBudgetV2(budgetProjects, statusMap, areaOverrides, extras, overrides)

  const prevSnap: SnapshotTotals | null = (snapRows && snapRows[0]?.totals) ? (snapRows[0].totals as SnapshotTotals) : null
  const delta = deltaVs(result, prevSnap)
  const prevSnapshotWeek: string | null = (snapRows && snapRows[0]?.week_ending) ? snapRows[0].week_ending : null

  const freshness: BudgetV2Freshness = {
    budget: (budHistRows as { updated_at?: string } | null)?.updated_at ?? null,
  }

  return { result, freshness, delta, prevSnapshotWeek }
}

/** Take (or refresh) the snapshot for a given ISO week-ending date. Idempotent —
 *  upsert on week_ending. Used by the weekly cron AND the "save snapshot" button. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function captureWeeklySnapshot(
  supabase: any, result: ComposeResult, weekEnding: string, capturedBy: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const totals = snapshotOf(result)
  const { error } = await supabase.from('budget_v2_weekly_snapshot').upsert(
    { week_ending: weekEnding, totals, captured_by: capturedBy, captured_at: new Date().toISOString() },
    { onConflict: 'week_ending' },
  )
  return error ? { ok: false, error: error.message } : { ok: true }
}
