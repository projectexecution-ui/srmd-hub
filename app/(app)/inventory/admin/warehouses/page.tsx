import { createClient } from '@/lib/supabase/server'
import { requirePermission, requireInventorySection } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { WarehouseList } from './warehouse-list'

export const dynamic = 'force-dynamic'

export default async function WarehousesAdminPage() {
  await requirePermission('inventory', 'admin', '/inventory')
  await requireInventorySection('inv-admin-warehouses')
  const supabase = await createClient()
  const [whRes, profilesRes] = await Promise.all([
    supabase.from('inv_warehouses').select('*').is('deleted_at', null).order('code'),
    supabase.from('profiles').select('id, name, full_name, email, role').eq('is_active', true).order('name'),
  ])

  const err = whRes.error ?? profilesRes.error

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader title="Warehouses" back="/inventory" subtitle="Physical stores in the inventory module" />
      <Card className="p-5">
        {err
          ? <QueryError what="warehouses" message={err.message} />
          : <WarehouseList
              warehouses={whRes.data ?? []}
              managers={(profilesRes.data ?? []).map(p => ({
                id: p.id,
                label: `${p.name || p.full_name || p.email} (${p.role})`,
              }))}
            />}
      </Card>
    </div>
  )
}
