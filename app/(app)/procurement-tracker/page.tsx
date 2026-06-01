import { requirePermission, getMyProfile } from '@/lib/auth'
import { ProcurementTrackerClient } from './client'

export const dynamic = 'force-dynamic'

export default async function ProcurementTrackerPage() {
  await requirePermission('procurement-tracker', 'view')
  // Pass admin status server-side so the page header can decide
  // whether to surface the in-module "Project Visibility" link
  // (lives at /procurement-tracker/admin).
  const profile = await getMyProfile()
  const isAdmin = profile?.role === 'admin'
  return <ProcurementTrackerClient isAdmin={isAdmin} />
}
