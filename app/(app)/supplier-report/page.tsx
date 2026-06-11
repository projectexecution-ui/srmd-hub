import { requirePermission, isPortalOwner, getMyProfile } from '@/lib/auth'
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
  return <SupplierReportClient canDelete={canDelete} />
}
