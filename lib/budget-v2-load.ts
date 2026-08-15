// Shared loader for the Budget vs Actual V2 tree. Fetches the BPH (budget) blob
// plus the V2-owned status/area/extra/override tables, then runs the SAME
// composeBudgetV2 engine the page uses. Both the /budget-vs-actual-v2 page AND
// the weekly Telegram report call this, so the report can never drift.
//
// Single source: every uploaded number comes from the budget report itself. On
// top of that, an admin can hand-add projects (extras with numbers) or flag a
// correction (budget_v2_override) — both shown as "manually adjusted".
//
// Week-over-week Δ is computed EXACTLY against the PREVIOUS UPLOAD: the last
// budget_hub_state_history version from an earlier IST day. Both sides are run
// through the same overrides/extras, so manual entries (e.g. Raj Uphaar) cancel
// out and the Δ reflects only what the two IN4 uploads actually moved. No manual
// snapshot to remember.
//
// Accepts any Supabase client (server client on the page, service client in the
// cron) — it only needs `.from(...).select(...)`.

import {
  composeBudgetV2, snapshotOf, deltaVs,
  type StatusMap, type AreaOverrideMap, type ExtraProject, type OverrideMap,
  type ComposeResult, type DeltaResult,
} from '@/lib/budget-v2'

export interface BudgetV2Freshness {
  budget: string | null
}

export interface BudgetV2LoadResult {
  result: ComposeResult
  freshness: BudgetV2Freshness
  /** week-over-week movement vs the previous upload (0s if there's no earlier one). */
  delta: DeltaResult
  /** the IST date of the previous upload the Δ compares against (null = none). */
  prevSnapshotWeek: string | null
}

const istDateOf = (iso: string): string => new Date(Date.parse(iso) + 5.5 * 3_600_000).toISOString().slice(0, 10)

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadBudgetV2(supabase: any): Promise<BudgetV2LoadResult> {
  const [
    { data: bud },
    { data: statusRows },
    { data: areaRows }, { data: extraRows }, { data: overrideRows },
    { data: budHistRows },
    { data: histMeta },
  ] = await Promise.all([
    supabase.from('budget_hub_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('budget_v2_project_status').select('project_name, status'),
    supabase.from('budget_v2_project_area').select('project_name, area_sft'),
    supabase.from('budget_v2_extra_project').select('name, group_name, area_sft, notes, budget, approved, paid'),
    supabase.from('budget_v2_override').select('project_name, budget, approved, paid, note, updated_at'),
    supabase.from('budget_hub_state').select('updated_at').eq('id', 'global').maybeSingle(),
    // Metadata only (no big state blobs) so we can pick the previous upload cheaply.
    supabase.from('budget_hub_state_history').select('version, snapshot_at').eq('state_id', 'global').order('version', { ascending: false }).limit(100),
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

  // Baseline = the previous UPLOAD: the newest history version from an earlier
  // IST day than the current one (collapses same-day re-saves into one upload).
  let delta = deltaVs(result, null)
  let prevSnapshotWeek: string | null = null
  const meta = (histMeta ?? []) as { version: number; snapshot_at: string }[]
  if (meta.length) {
    const curDate = istDateOf(meta[0].snapshot_at)
    const prevMeta = meta.find(m => istDateOf(m.snapshot_at) < curDate)
    if (prevMeta) {
      const { data: prevRow } = await supabase.from('budget_hub_state_history')
        .select('state').eq('state_id', 'global').eq('version', prevMeta.version).maybeSingle()
      const prevProjects = ((prevRow?.state as any)?.projects ?? []) as any[]
      if (prevProjects.length) {
        // Same overrides/extras on both sides → manual entries cancel; Δ = real upload movement.
        const prevResult = composeBudgetV2(prevProjects, statusMap, areaOverrides, extras, overrides)
        delta = deltaVs(result, snapshotOf(prevResult))
        prevSnapshotWeek = istDateOf(prevMeta.snapshot_at)
      }
    }
  }

  const freshness: BudgetV2Freshness = {
    budget: (budHistRows as { updated_at?: string } | null)?.updated_at ?? null,
  }

  return { result, freshness, delta, prevSnapshotWeek }
}
