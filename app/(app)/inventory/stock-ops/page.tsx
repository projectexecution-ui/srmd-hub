import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { StockOpsForms } from './StockOpsForms'

export const dynamic = 'force-dynamic'

export default async function StockOpsPage() {
  await requirePermission('inventory', 'edit', '/inventory')
  const supabase = await createClient()
  const [whRes, itemsRes] = await Promise.all([
    supabase.from('inv_warehouses').select('id, code, name').eq('is_active', true).order('code'),
    supabase.from('inv_items').select('id, code, name, unit, category, image_url').eq('is_active', true).order('code'),
  ])
  const err = whRes.error ?? itemsRes.error
  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <PageHeader
        title="Stock corrections"
        back="/inventory"
        subtitle="Fix a miscount, move stock between stores, or write off damaged material. Every correction is logged."
      />
      <Card className="p-5">
        {err
          ? <QueryError what="stock corrections" message={err.message} />
          : <StockOpsForms warehouses={whRes.data ?? []} items={itemsRes.data ?? []} />}
      </Card>
    </div>
  )
}
