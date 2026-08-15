import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { composeBudgetV2, type StatusMap, type ExtraProject, type OverrideMap } from '@/lib/budget-v2'
import PrintClient from './print-client'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function BudgetV2PrintPage() {
  await requirePermission('budget-vs-actual-v2', 'view')
  const supabase = await createClient()
  const [{ data: bud }, { data: statusRows }, { data: areaRows }, { data: extraRows }, { data: overrideRows }] = await Promise.all([
    supabase.from('budget_hub_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('budget_v2_project_status').select('project_name, status'),
    supabase.from('budget_v2_project_area').select('project_name, area_sft'),
    supabase.from('budget_v2_extra_project').select('name, group_name, area_sft, budget, approved, paid'),
    supabase.from('budget_v2_override').select('project_name, budget, approved, paid, note, updated_at'),
  ])
  const statusMap: StatusMap = {}
  for (const r of statusRows ?? []) statusMap[r.project_name] = r.status as 'open' | 'closed'
  const areaOverrides: Record<string, number> = {}
  for (const r of areaRows ?? []) if (typeof r.area_sft === 'number') areaOverrides[r.project_name] = r.area_sft
  const extras: ExtraProject[] = (extraRows ?? []).map((r: any) => ({
    name: r.name, group_name: r.group_name, area_sft: r.area_sft, budget: r.budget, approved: r.approved, paid: r.paid,
  }))
  const overrides: OverrideMap = {}
  for (const r of overrideRows ?? []) overrides[r.project_name] = { budget: r.budget, approved: r.approved, paid: r.paid, note: r.note, updated_at: r.updated_at }
  const result = composeBudgetV2(
    ((bud?.state as any)?.projects ?? []) as any[],
    statusMap, areaOverrides, extras, overrides,
  )
  return <PrintClient result={result} />
}
