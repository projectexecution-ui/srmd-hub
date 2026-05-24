import { createClient } from '@/lib/supabase/server'
import { requirePermission, requireInventorySection, getMyUser, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { RequestList } from '@/components/inventory/RequestList'

export const dynamic = 'force-dynamic'

export default async function NewReturnPage() {
  await requirePermission('inventory', 'edit', '/inventory')
  await requireInventorySection('inv-returns')
  const [user, profile] = await Promise.all([getMyUser(), getMyProfile()])
  const supabase = await createClient()

  // Engineers see only their own issued requests; admins / store / etc see all.
  const role = profile?.role
  const seeAll = role === 'admin' || role === 'store_manager'

  let query = supabase
    .from('inv_requests')
    .select('id, request_no, status, urgency, purpose, created_at, projects(code, name), inv_warehouses(code)')
    .in('status', ['ISSUED', 'CLOSED', 'EMERGENCY_ISSUED'])
    .order('created_at', { ascending: false })
    .limit(100)
  if (!seeAll && user?.id) query = query.eq('engineer_id', user.id)

  const { data } = await query

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Log a return"
        back="/inventory"
        subtitle="Pick the request the material was issued against, then log the return on its detail page"
      />
      <Card className="p-4 bg-blue-50 border-blue-200 text-sm text-blue-900">
        Open any of the issued requests below and use the <b>Log a return</b> panel at the bottom of the page.
      </Card>
      <RequestList rows={data ?? []} emptyText="No issued requests yet." />
    </div>
  )
}
