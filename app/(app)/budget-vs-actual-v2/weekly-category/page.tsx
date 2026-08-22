import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { getBudgetV2 } from '@/lib/budget-v2-cached'
import WeeklyDetailClient from '../weekly-detail-client'

export const dynamic = 'force-dynamic'

export default async function BudgetV2WeeklyCategoryPage() {
  await requirePermission('budget-vs-actual-v2', 'view')
  const supabase = await createClient()
  const { result, freshness, delta, prevSnapshotWeek, prev } = await getBudgetV2(supabase)
  return <WeeklyDetailClient result={result} prev={prev} delta={delta} freshness={freshness} prevSnapshotWeek={prevSnapshotWeek} mode="category" />
}
