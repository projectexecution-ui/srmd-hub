import { requirePermission } from '@/lib/auth'
import ContractorReportClient from './report-client'

export const dynamic = 'force-dynamic'

export default async function ContractorReportPage() {
  // Gate on the module's own slug. Permissions are seeded in role_permissions
  // (mirroring procurement-tracker); admins manage them from /admin/permissions.
  await requirePermission('contractor-report', 'view')
  return <ContractorReportClient />
}
