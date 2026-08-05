import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { RequestsBrowser } from './RequestsBrowser'
import { Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

const CAP = 300

export default async function MyRequestsPage() {
  await requirePermission('inventory', 'view')
  const [user, profile] = await Promise.all([getMyUser(), getMyProfile()])
  const supabase = await createClient()

  // Engineers see only their own. Approval roles + admin see everything.
  const role = profile?.role
  const seeAll = role === 'admin' || role === 'backoffice' || role === 'backoffice_backup' || role === 'hop' || role === 'store_manager'

  let query = supabase
    .from('inv_requests')
    .select('id, request_no, status, urgency, purpose, required_by_date, created_at, projects(code, name), inv_warehouses(code)')
    .order('created_at', { ascending: false })
    .limit(CAP)
  if (!seeAll && user?.id) query = query.eq('engineer_id', user.id)

  const { data, error } = await query
  const rows = data ?? []

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title={seeAll ? 'All requests' : 'My requests'} back="/inventory">
        <Button asChild size="sm">
          <Link href="/inventory/requests/new"><Plus className="h-4 w-4" /> New request</Link>
        </Button>
      </PageHeader>

      {error
        ? <QueryError what="requests" message={error.message} />
        : <RequestsBrowser rows={rows} capped={rows.length >= CAP} />}
    </div>
  )
}
