import { requirePermission, isPortalOwner, getMyProfile } from '@/lib/auth'
import ContractorReportClient from './report-client'

export const dynamic = 'force-dynamic'

export default async function ContractorReportPage() {
  // Gate on the module's own slug. Permissions are seeded in role_permissions
  // (mirroring procurement-tracker); admins manage them from /admin/permissions.
  await requirePermission('contractor-report', 'view')
  // Only Portal Owner / admin can delete a saved project — everyone else sees
  // the chip but no X. (Saved reports affect the whole team.)
  const [profile, portalOwner] = await Promise.all([getMyProfile(), isPortalOwner()])
  const canDelete = portalOwner || profile?.role === 'admin'
  return <ContractorReportClient canDelete={canDelete} />
}
