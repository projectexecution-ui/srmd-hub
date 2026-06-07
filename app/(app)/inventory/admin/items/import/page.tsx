import { createClient } from '@/lib/supabase/server'
import { requirePermission, requireInventorySection } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { ImportForm } from './ImportForm'

export const dynamic = 'force-dynamic'

export default async function ImportItemsPage() {
  await requirePermission('inventory', 'admin', '/inventory')
  await requireInventorySection('inv-admin-items')
  const supabase = await createClient()
  // We pull existing item codes so the client can flag duplicates inline
  // during preview instead of waiting for the insert to bounce.
  const { data, error } = await supabase
    .from('inv_items')
    .select('code')
  const existingCodes = (data ?? []).map(r => (r.code as string).toLowerCase())

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Bulk import items"
        back="/inventory/admin/items"
        subtitle="Upload a .xlsx to add items to the master in one shot. Existing codes are skipped, not overwritten."
      />
      {error ? (
        <QueryError what="existing item codes" message={error.message} />
      ) : (
        <Card className="p-5">
          <ImportForm existingCodes={existingCodes} />
        </Card>
      )}
    </div>
  )
}
