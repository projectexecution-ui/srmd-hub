import { requirePermission } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { ItemForm } from '../item-form'

export default async function NewItemPage() {
  await requirePermission('jmr-admin', 'edit')
  return (
    <Card className="p-4">
      <h2 className="text-lg font-bold mb-4">New item</h2>
      <ItemForm />
    </Card>
  )
}
