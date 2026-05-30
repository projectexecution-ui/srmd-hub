import { requirePermission } from '@/lib/auth'
import { ProcurementTrackerClient } from './client'

export const dynamic = 'force-dynamic'

export default async function ProcurementTrackerPage() {
  await requirePermission('procurement-tracker', 'view')
  return <ProcurementTrackerClient />
}
