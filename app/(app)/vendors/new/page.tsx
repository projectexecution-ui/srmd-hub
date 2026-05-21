import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { VendorForm } from '../vendor-form'

export default async function NewVendorPage() {
  await requirePermission('vendors', 'edit', '/vendors')

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto">
      <PageHeader title="New Vendor" back="/vendors" />
      <Card><CardContent className="pt-6"><VendorForm /></CardContent></Card>
    </div>
  )
}
