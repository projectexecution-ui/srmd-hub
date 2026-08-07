import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyUser, isPortalOwner } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RequestList } from '@/components/inventory/RequestList'
import { QueryError } from '@/components/ui/query-error'

export const dynamic = 'force-dynamic'

type InvReqRow = {
  id: string; request_no: string; status: string; urgency: string
  purpose: string | null; created_at: string | null
  projects: { code: string; name: string } | { code: string; name: string }[] | null
  inv_warehouses: { code: string } | { code: string }[] | null
}

export default async function StoreInboxPage() {
  const perms = await requirePermission('inventory', 'view')
  const [user, portalOwner] = await Promise.all([getMyUser(), isPortalOwner()])
  const supabase = await createClient()
  // Admins / Portal Owner see every store's queue; a storekeeper sees only the
  // requests bound for a warehouse THEY keep (inv_warehouses.store_manager_id).
  const seesAll = portalOwner || can(perms, 'inventory', 'admin')

  let myWarehouseIds: string[] = []
  let keeperError: string | undefined
  if (!seesAll) {
    const { data: whs, error } = await supabase
      .from('inv_warehouses')
      .select('id')
      .eq('store_manager_id', user?.id ?? '')
    keeperError = error?.message
    myWarehouseIds = (whs ?? []).map(w => w.id as string)
  }

  let rows: InvReqRow[] = []
  let error: string | undefined
  if (seesAll || myWarehouseIds.length > 0) {
    let query = supabase
      .from('inv_requests')
      .select('id, request_no, status, urgency, purpose, created_at, projects(code, name), inv_warehouses(code)')
      .in('status', ['APPROVED', 'EMERGENCY_ISSUED'])
      .order('created_at')
    if (!seesAll) query = query.in('warehouse_id', myWarehouseIds)
    const res = await query
    rows = (res.data ?? []) as InvReqRow[]
    error = res.error?.message
  }

  // Issued requests still waiting for the signed gate pass (= not yet receipted).
  let gpRows: InvReqRow[] = []
  let gpError: string | undefined
  if (seesAll || myWarehouseIds.length > 0) {
    let gq = supabase
      .from('inv_requests')
      .select('id, request_no, status, urgency, purpose, created_at, projects(code, name), inv_warehouses(code)')
      .in('status', ['ISSUED', 'EMERGENCY_ISSUED'])
      .is('engineer_acknowledged_at', null)
      .order('created_at')
    if (!seesAll) gq = gq.in('warehouse_id', myWarehouseIds)
    const res2 = await gq
    gpRows = (res2.data ?? []) as InvReqRow[]
    gpError = res2.error?.message
  }

  const emptyText = !seesAll && myWarehouseIds.length === 0
    ? "You're not set as the keeper of any store yet — ask your admin to assign you on the Warehouses page."
    : 'Nothing to issue right now.'

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader title="Store inbox" back="/inventory" subtitle="Issue approved requests, then upload the signed gate pass" />
      {keeperError ? (
        <QueryError what="your stores" message={keeperError} />
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">To issue</h2>
            <RequestList rows={rows as never} error={error} emptyText={emptyText} />
          </section>
          {(seesAll || myWarehouseIds.length > 0) && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-gray-700">Awaiting signed gate pass</h2>
              <p className="text-xs text-gray-500">Already issued — open each one and upload the engineer-signed gate pass to close it.</p>
              <RequestList rows={gpRows as never} error={gpError} emptyText="Nothing waiting for a gate pass." />
            </section>
          )}
        </>
      )}
    </div>
  )
}
