import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { loadBudgetV2 } from '@/lib/budget-v2-load'
import WeeklyClient from './weekly-client'

export const dynamic = 'force-dynamic'

export default async function BudgetV2WeeklyPage() {
  await requirePermission('budget-vs-actual-v2', 'view')
  const supabase = await createClient()
  const { result, freshness, delta, prevSnapshotWeek } = await loadBudgetV2(supabase)
  return <WeeklyClient result={result} freshness={freshness} delta={delta} prevSnapshotWeek={prevSnapshotWeek} />
}
