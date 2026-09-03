import { requirePermission } from '@/lib/auth'
import { BphHubClient } from './bph-hub-client'

export const dynamic = 'force-dynamic'

// The BPH hub is the full ERP budget. It used to be a client component with
// no gate at all — any signed-in account, viewers included, could open it,
// and the module on/off switch never reached it. The gate lives here; the
// iframe shell is unchanged in bph-hub-client.tsx.
export default async function BPHReportHubPage() {
  await requirePermission('budget-vs-actual', 'view')
  return <BphHubClient />
}
