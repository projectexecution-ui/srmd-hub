import { createClient } from '@/lib/supabase/server'
import { requirePermission, requireInventorySection } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RequestList } from '@/components/inventory/RequestList'

export const dynamic = 'force-dynamic'

export default async function HopInboxPage() {
  await requirePermission('inventory', 'view')
  await requireInventorySection('inv-inbox-hop')
  const supabase = await createClient()
  // HoP sees both their stage (PENDING_HOP) and the Backoffice queue
  // (PENDING_BACKOFFICE) so they can emergency-bypass when needed.
  const { data } = await supabase
    .from('inv_requests')
    .select('id, request_no, status, urgency, purpose, created_at, projects(code, name), inv_warehouses(code)')
    .in('status', ['PENDING_HOP', 'PENDING_BACKOFFICE'])
    .order('created_at')

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="HoP inbox" back="/inventory" subtitle="Final approval — and emergency bypass for the Backoffice queue" />
      <RequestList rows={data ?? []} emptyText="No pending requests in your queue." />
    </div>
  )
}
