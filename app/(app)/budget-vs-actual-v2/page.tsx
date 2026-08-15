import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser, getMyProfile, isPortalOwner } from '@/lib/auth'
import { loadBudgetV2 } from '@/lib/budget-v2-load'
import BudgetV2Client from './client'

export const dynamic = 'force-dynamic'

export default async function BudgetV2Page() {
  await requirePermission('budget-vs-actual-v2', 'view')
  const [user, profile, portalOwner] = await Promise.all([getMyUser(), getMyProfile(), isPortalOwner()])
  const isAdmin = !!portalOwner || profile?.role === 'admin'
  const supabase = await createClient()

  // Shared loader (also used by the weekly Telegram report) so the page and the
  // report are composed from exactly the same tree.
  const { result, freshness, delta, prevSnapshotWeek } = await loadBudgetV2(supabase)
  // Existing group names (real BPH groups + any V2-extra group) for the
  // Add-project dropdown.
  const knownGroupNames = Array.from(new Set(result.groups.map(g => g.name).filter(n => n !== '— Ungrouped'))).sort()

  return (
    <BudgetV2Client
      result={result}
      knownGroupNames={knownGroupNames}
      currentUserId={user!.id}
      isAdmin={isAdmin}
      freshness={freshness}
      delta={delta}
      prevSnapshotWeek={prevSnapshotWeek}
    />
  )
}
