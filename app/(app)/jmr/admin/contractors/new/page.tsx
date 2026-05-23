import { requirePermission } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { ContractorForm } from '../contractor-form'

export default async function NewContractorPage() {
  await requirePermission('jmr-admin', 'edit')
  return (
    <Card className="p-4">
      <h2 className="text-lg font-bold mb-4">New contractor</h2>
      <ContractorForm />
    </Card>
  )
}
