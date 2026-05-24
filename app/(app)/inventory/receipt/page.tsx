import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { ReceiptForm } from './receipt-form'

export const dynamic = 'force-dynamic'

export default async function StockReceiptPage() {
  await requirePermission('inventory', 'edit', '/inventory')
  const supabase = await createClient()
  const [whRes, itemsRes] = await Promise.all([
    supabase.from('inv_warehouses').select('id, code, name').eq('is_active', true).order('code'),
    supabase.from('inv_items').select('id, code, name, unit').eq('is_active', true).order('code'),
  ])

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <PageHeader
        title="Stock receipt"
        back="/inventory"
        subtitle="Record vendor delivery into a warehouse"
      />
      <Card className="p-5">
        <ReceiptForm
          warehouses={whRes.data ?? []}
          items={itemsRes.data ?? []}
        />
      </Card>
    </div>
  )
}
