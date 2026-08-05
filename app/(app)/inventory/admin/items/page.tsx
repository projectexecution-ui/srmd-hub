import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { QueryError } from '@/components/ui/query-error'
import { Upload } from 'lucide-react'
import { ItemList } from './item-list'
import { PendingItemsReview } from './PendingItemsReview'

export const dynamic = 'force-dynamic'

export default async function ItemsAdminPage() {
  await requirePermission('inventory', 'admin', '/inventory')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('inv_items')
    .select('*')
    .is('deleted_at', null)
    .order('code')

  const all = data ?? []
  const pending = all.filter(i => (i as { approval_status?: string }).approval_status === 'pending')
  const catalogue = all.filter(i => (i as { approval_status?: string }).approval_status !== 'pending')

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader title="Item Master" back="/inventory" subtitle="Catalogue of materials. Codes are unique.">
        <Button asChild size="sm" variant="outline">
          <Link href="/inventory/admin/items/import">
            <Upload className="h-4 w-4" /> Bulk import
          </Link>
        </Button>
      </PageHeader>
      {error ? (
        <QueryError what="the item master" message={error.message} />
      ) : (
        <>
          <PendingItemsReview items={pending as never} />
          <Card className="p-5">
            <ItemList items={catalogue} />
          </Card>
        </>
      )}
    </div>
  )
}
