import { requirePermission, isPortalOwner, getMyProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { readFeedModes, readLastFeedSync } from '@/lib/in4/feeds'
import SupplierReportClient from './report-client'

export const dynamic = 'force-dynamic'

export default async function SupplierReportPage() {
  // Gate on the module's own slug. Permissions are seeded in role_permissions
  // (mirroring contractor-report); admins manage them from /admin/permissions.
  await requirePermission('supplier-report', 'view')
  // Only Portal Owner / admin can delete a saved project — everyone else sees
  // the chip but no X. (Saved reports affect the whole team.)
  const [profile, portalOwner] = await Promise.all([getMyProfile(), isPortalOwner()])
  const canDelete = portalOwner || profile?.role === 'admin'
  // When the IN4 feed is live this report is written from IN4 twice a day; the
  // Excel upload is hidden and the header says so.
  const supabase = await createClient()
  const [modes, last] = await Promise.all([readFeedModes(supabase), readLastFeedSync(supabase, 'supplier')])
  const in4 = modes.supplier === 'live' ? { live: true, at: last?.ok ? last.at : null, error: last && !last.ok ? (last.error ?? 'failed') : null } : null
  return <SupplierReportClient canDelete={canDelete} in4={in4} />
}
