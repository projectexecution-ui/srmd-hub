// Shared loader for the Budget vs Actual V2 tree. Fetches the three read-only
// source blobs (BPH budget + contractor + supplier payments) plus the V2-owned
// mapping tables, then runs the SAME composeBudgetV2 engine the page uses. Both
// the /budget-vs-actual-v2 page AND the weekly Telegram report call this, so the
// report can never drift from what the page shows.
//
// Accepts any Supabase client (server client on the page, service client in the
// cron) — it only needs `.from(...).select(...)`.

import {
  composeBudgetV2,
  type AliasRow, type StatusMap, type AreaOverrideMap, type ExtraProject, type ComposeResult,
} from '@/lib/budget-v2'

export interface BudgetV2Freshness {
  budget: string | null
  contractor: string | null
  supplier: string | null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadBudgetV2(supabase: any): Promise<{ result: ComposeResult; freshness: BudgetV2Freshness }> {
  const [
    { data: bud }, { data: con }, { data: sup },
    { data: statusRows }, { data: aliasRows },
    { data: areaRows }, { data: extraRows },
    { data: budHistRows }, { data: conHistRows }, { data: supHistRows },
  ] = await Promise.all([
    supabase.from('budget_hub_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('contractor_report_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('supplier_report_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('budget_v2_project_status').select('project_name, status'),
    supabase.from('budget_v2_alias').select('source, payment_name, budget_project, confirmed'),
    supabase.from('budget_v2_project_area').select('project_name, area_sft'),
    supabase.from('budget_v2_extra_project').select('name, group_name, area_sft, notes'),
    supabase.from('budget_hub_state').select('updated_at').eq('id', 'global').maybeSingle(),
    supabase.from('contractor_report_state').select('updated_at').eq('id', 'global').maybeSingle(),
    supabase.from('supplier_report_state').select('updated_at').eq('id', 'global').maybeSingle(),
  ])

  const budgetProjects = ((bud?.state as any)?.projects ?? []) as any[]
  const contractorReports = ((con?.state as any)?.reports ?? []) as any[]
  const supplierReports = ((sup?.state as any)?.reports ?? []) as any[]

  const statusMap: StatusMap = {}
  for (const r of statusRows ?? []) statusMap[r.project_name] = r.status as 'open' | 'closed'
  const aliases = (aliasRows ?? []) as AliasRow[]
  const areaOverrides: AreaOverrideMap = {}
  for (const r of areaRows ?? []) if (typeof r.area_sft === 'number') areaOverrides[r.project_name] = r.area_sft
  const extras: ExtraProject[] = (extraRows ?? []).map((r: { name: string; group_name?: string | null; area_sft?: number | null }) => ({
    name: r.name, group_name: r.group_name, area_sft: r.area_sft,
  }))

  const result = composeBudgetV2(budgetProjects, contractorReports, supplierReports, aliases, statusMap, areaOverrides, extras)

  const freshness: BudgetV2Freshness = {
    budget: (budHistRows as { updated_at?: string } | null)?.updated_at ?? null,
    contractor: (conHistRows as { updated_at?: string } | null)?.updated_at ?? null,
    supplier: (supHistRows as { updated_at?: string } | null)?.updated_at ?? null,
  }

  return { result, freshness }
}
