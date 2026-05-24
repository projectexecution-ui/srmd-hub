import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, requireInventorySection, getMyUser, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RequestStatusPill } from '@/components/inventory/RequestStatusPill'
import { formatDate } from '@/lib/utils'
import { Plus } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function MyRequestsPage() {
  await requirePermission('inventory', 'view')
  await requireInventorySection('inv-requests')
  const [user, profile] = await Promise.all([getMyUser(), getMyProfile()])
  const supabase = await createClient()

  // Engineers see only their own. Approval roles + admin see everything.
  const role = profile?.role
  const seeAll = role === 'admin' || role === 'backoffice' || role === 'backoffice_backup' || role === 'hop' || role === 'store_manager'

  let query = supabase
    .from('inv_requests')
    .select('id, request_no, status, urgency, purpose, required_by_date, created_at, projects(code, name), inv_warehouses(code)')
    .order('created_at', { ascending: false })
    .limit(100)
  if (!seeAll && user?.id) query = query.eq('engineer_id', user.id)

  const { data } = await query
  const rows = data ?? []

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title={seeAll ? 'All requests' : 'My requests'} back="/inventory">
        <Button asChild size="sm">
          <Link href="/inventory/requests/new"><Plus className="h-4 w-4" /> New request</Link>
        </Button>
      </PageHeader>

      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-gray-500">No requests yet.</Card>
      ) : (
        <Card className="divide-y divide-gray-100">
          {rows.map((r) => {
            const proj = Array.isArray(r.projects) ? r.projects[0] : r.projects
            const wh = Array.isArray(r.inv_warehouses) ? r.inv_warehouses[0] : r.inv_warehouses
            return (
              <Link key={r.id} href={`/inventory/requests/${r.id}`}
                className="flex items-center justify-between gap-3 p-4 hover:bg-gray-50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-blue-700">{r.request_no}</span>
                    <RequestStatusPill status={r.status} />
                    {r.urgency !== 'normal' && (
                      <span className={`text-[10px] uppercase font-bold ${r.urgency === 'emergency' ? 'text-rose-700' : 'text-amber-700'}`}>
                        {r.urgency}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {proj?.code ?? '—'}{wh?.code ? ` · ${wh.code}` : ''} · {formatDate(r.created_at ?? '')}
                  </p>
                  {r.purpose && <p className="text-xs text-gray-600 mt-1 line-clamp-1">{r.purpose}</p>}
                </div>
              </Link>
            )
          })}
        </Card>
      )}
    </div>
  )
}
