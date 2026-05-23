import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { ContractorForm } from '../contractor-form'

export const dynamic = 'force-dynamic'

export default async function EditContractorPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('jmr-admin', 'edit')
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('jmr_contractors').select('*').eq('id', id).single()
  if (!data) notFound()

  return (
    <Card className="p-4">
      <h2 className="text-lg font-bold mb-4">Edit contractor</h2>
      <ContractorForm initial={data} contractorId={id} />
    </Card>
  )
}
