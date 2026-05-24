import { createClient } from '@/lib/supabase/server'
import { requirePermission, requireInventorySection } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RequestList } from '@/components/inventory/RequestList'

export const dynamic = 'force-dynamic'

export default async function BackofficeInboxPage() {
  await requirePermission('inventory', 'view')
  await requireInventorySection('inv-inbox-backoffice')
  const supabase = await createClient()
  const { data } = await supabase
    .from('inv_requests')
    .select('id, request_no, status, urgency, purpose, created_at, projects(code, name), inv_warehouses(code)')
    .eq('status', 'PENDING_BACKOFFICE')
    .order('created_at')

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Backoffice inbox" back="/inventory" subtitle="Requests pending first-level approval" />
      <RequestList rows={data ?? []} emptyText="Nothing pending. Engineers haven't raised anything new." />
    </div>
  )
}
