import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { composeBudgetV2, type AliasRow, type StatusMap } from '@/lib/budget-v2'
import PrintClient from './print-client'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function BudgetV2PrintPage() {
  await requirePermission('budget-vs-actual-v2', 'view')
  const supabase = await createClient()
  const [{ data: bud }, { data: con }, { data: sup }, { data: statusRows }, { data: aliasRows }] = await Promise.all([
    supabase.from('budget_hub_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('contractor_report_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('supplier_report_state').select('state').eq('id', 'global').maybeSingle(),
    supabase.from('budget_v2_project_status').select('project_name, status'),
    supabase.from('budget_v2_alias').select('source, payment_name, budget_project, confirmed'),
  ])
  const statusMap: StatusMap = {}
  for (const r of statusRows ?? []) statusMap[r.project_name] = r.status as 'open' | 'closed'
  const result = composeBudgetV2(
    ((bud?.state as any)?.projects ?? []) as any[],
    ((con?.state as any)?.reports ?? []) as any[],
    ((sup?.state as any)?.reports ?? []) as any[],
    (aliasRows ?? []) as AliasRow[],
    statusMap,
  )
  return <PrintClient result={result} />
}
