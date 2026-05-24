import { createClient } from '@/lib/supabase/server'
import { requirePermission, requireInventorySection } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { ItemList } from './item-list'

export const dynamic = 'force-dynamic'

export default async function ItemsAdminPage() {
  await requirePermission('inventory', 'admin', '/inventory')
  await requireInventorySection('inv-admin-items')
  const supabase = await createClient()
  const { data } = await supabase
    .from('inv_items')
    .select('*')
    .order('code')

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader title="Item Master" back="/inventory" subtitle="Catalogue of materials. Codes are unique." />
      <Card className="p-5">
        <ItemList items={data ?? []} />
      </Card>
    </div>
  )
}
