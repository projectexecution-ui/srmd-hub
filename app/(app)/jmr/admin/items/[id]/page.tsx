import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { ItemForm } from '../item-form'

export const dynamic = 'force-dynamic'

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('jmr-admin', 'edit')
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.from('jmr_items').select('*').eq('id', id).single()
  if (!data) notFound()

  return (
    <Card className="p-4">
      <h2 className="text-lg font-bold mb-4">Edit item</h2>
      <ItemForm initial={data} itemId={id} />
    </Card>
  )
}
