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
  // Existing codes power the duplicate detector. Warehouses populate the
  // "land opening qty into" dropdown — when the Excel has a Quantity On
  // Hand column we can write inv_stock + an adjustment movement so it
  // shows up immediately on the inventory pages.
  const [{ data: codes, error: codeErr }, { data: warehouses, error: whErr }] = await Promise.all([
    supabase.from('inv_items').select('code'),
    supabase.from('inv_warehouses').select('id, code, name, location').eq('is_active', true).order('name'),
  ])
  const existingCodes = (codes ?? []).map(r => (r.code as string).toLowerCase())
  const err = codeErr ?? whErr

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Bulk import items"
        back="/inventory/admin/items"
        subtitle="Upload a .xlsx to add items to the master in one shot. Re-upload the same file later with “Update existing” on to refresh changed fields. Odoo product.template exports are supported — Code is auto-generated from Name when missing, and the Quantity On Hand column can land as opening stock in the warehouse you pick."
      />
      {err ? (
        <QueryError what="existing item codes / warehouses" message={err.message} />
      ) : (
        <Card className="p-5">
          <ImportForm
            existingCodes={existingCodes}
            warehouses={warehouses ?? []}
          />
        </Card>
      )}
    </div>
  )
}
