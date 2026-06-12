import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { composeBudgetV2, type AliasRow, type StatusMap } from '@/lib/budget-v2'
import BudgetV2Client from './client'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function BudgetV2Page() {
  await requirePermission('budget-vs-actual-v2', 'view')
  const user = await getMyUser()
  const supabase = await createClient()

  const [{ data: bud }, { data: con }, { data: sup }, { data: statusRows }, { data: aliasRows }] = await Promise.all([
    supabase.from('budget_hub_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('contractor_report_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('supplier_report_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('budget_v2_project_status').select('project_name, status'),
    supabase.from('budget_v2_alias').select('source, payment_name, budget_project, confirmed'),
  ])

  const budgetProjects = ((bud?.state as any)?.projects ?? []) as any[]
  const contractorReports = ((con?.state as any)?.reports ?? []) as any[]
  const supplierReports = ((sup?.state as any)?.reports ?? []) as any[]

  const statusMap: StatusMap = {}
  for (const r of statusRows ?? []) statusMap[r.project_name] = r.status as 'open' | 'closed'
  const aliases = (aliasRows ?? []) as AliasRow[]

  const result = composeBudgetV2(budgetProjects, contractorReports, supplierReports, aliases, statusMap)
  const budgetProjectNames = result.groups.flatMap(g => g.projects.map(p => p.name)).sort((a, b) => a.localeCompare(b))

  return (
    <BudgetV2Client
      result={result}
      budgetProjectNames={budgetProjectNames}
      currentUserId={user!.id}
    />
  )
}
