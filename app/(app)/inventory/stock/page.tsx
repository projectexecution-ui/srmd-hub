import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { StockTable } from './stock-table'

export const dynamic = 'force-dynamic'

export default async function StockPage({
  searchParams,
}: { searchParams: Promise<{ warehouse?: string }> }) {
  const perms = await requirePermission('inventory', 'view')
  const canEdit = can(perms, 'inventory', 'edit')
  const sp = await searchParams
  const supabase = await createClient()

  const [whRes, stockRes] = await Promise.all([
    supabase.from('inv_warehouses').select('id, code, name').eq('is_active', true).order('code'),
    supabase.from('inv_stock_available').select('*').order('item_code'),
  ])

  const warehouses = whRes.data ?? []
  const allRows = stockRes.data ?? []
  const selectedWarehouse = sp.warehouse || warehouses[0]?.id || null
  const rows = selectedWarehouse
    ? allRows.filter(r => r.warehouse_id === selectedWarehouse)
    : []

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader title="Stock" back="/inventory" subtitle="Available quantity per item per warehouse" />
      <Card className="p-5">
        {whRes.error
          ? <QueryError what="warehouses" message={whRes.error.message} />
          : stockRes.error
          ? <QueryError what="stock" message={stockRes.error.message} />
          : <StockTable warehouses={warehouses} selectedWarehouse={selectedWarehouse} rows={rows} canEdit={canEdit} />}
      </Card>
    </div>
  )
}
