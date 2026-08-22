import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { getBudgetV2 } from '@/lib/budget-v2-cached'
import WeeklyClient from './weekly-client'

export const dynamic = 'force-dynamic'

export default async function BudgetV2WeeklyPage() {
  await requirePermission('budget-vs-actual-v2', 'view')
  const supabase = await createClient()
  const { result, freshness, delta, prevSnapshotWeek } = await getBudgetV2(supabase)
  return <WeeklyClient result={result} freshness={freshness} delta={delta} prevSnapshotWeek={prevSnapshotWeek} />
}
