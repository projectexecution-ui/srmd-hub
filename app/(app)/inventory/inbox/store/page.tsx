import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RequestList } from '@/components/inventory/RequestList'

export const dynamic = 'force-dynamic'

export default async function StoreInboxPage() {
  await requirePermission('inventory', 'view')
  const supabase = await createClient()
  // Store Manager sees what's been approved (regular path) + what's been
  // emergency-authorised by HoP — both ready for physical issue.
  const { data } = await supabase
    .from('inv_requests')
    .select('id, request_no, status, urgency, purpose, created_at, projects(code, name), inv_warehouses(code)')
    .in('status', ['APPROVED', 'EMERGENCY_ISSUED'])
    .order('created_at')

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Store inbox" back="/inventory" subtitle="Approved requests ready to be issued from the warehouse" />
      <RequestList rows={data ?? []} emptyText="Nothing to issue right now." />
    </div>
  )
}
