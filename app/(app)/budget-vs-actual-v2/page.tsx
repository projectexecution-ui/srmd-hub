import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser, getMyProfile, isPortalOwner } from '@/lib/auth'
import { composeBudgetV2, type AliasRow, type StatusMap, type AreaOverrideMap, type ExtraProject } from '@/lib/budget-v2'
import BudgetV2Client from './client'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function BudgetV2Page() {
  await requirePermission('budget-vs-actual-v2', 'view')
  const [user, profile, portalOwner] = await Promise.all([getMyUser(), getMyProfile(), isPortalOwner()])
  const isAdmin = !!portalOwner || profile?.role === 'admin'
  const supabase = await createClient()

  const [
    { data: bud }, { data: con }, { data: sup },
    { data: statusRows }, { data: aliasRows },
    { data: areaRows }, { data: extraRows },
    // Freshness — latest history snapshot per source. Reads the same history
    // tables the originals already write to, so V2 stays read-only.
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
  const extras: ExtraProject[] = (extraRows ?? []).map(r => ({
    name: r.name, group_name: r.group_name, area_sft: r.area_sft,
  }))

  const result = composeBudgetV2(budgetProjects, contractorReports, supplierReports, aliases, statusMap, areaOverrides, extras)
  const budgetProjectNames = result.groups.flatMap(g => g.projects.map(p => p.name)).sort((a, b) => a.localeCompare(b))
  // Existing group names (real BPH groups + any V2-extra group) for the
  // Add-project dropdown.
  const knownGroupNames = Array.from(new Set(result.groups.map(g => g.name).filter(n => n !== '— Ungrouped'))).sort()

  const freshness = {
    budget: (budHistRows as { updated_at?: string } | null)?.updated_at ?? null,
    contractor: (conHistRows as { updated_at?: string } | null)?.updated_at ?? null,
    supplier: (supHistRows as { updated_at?: string } | null)?.updated_at ?? null,
  }

  return (
    <BudgetV2Client
      result={result}
      budgetProjectNames={budgetProjectNames}
      knownGroupNames={knownGroupNames}
      currentUserId={user!.id}
      isAdmin={isAdmin}
      freshness={freshness}
    />
  )
}
