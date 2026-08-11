import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { BillForm } from './BillForm'

export const dynamic = 'force-dynamic'

export default async function NewBillPage() {
  await requirePermission('bills-booking', 'edit')
  const supabase = await createClient()
  const [{ data: projects }, { data: vendors }] = await Promise.all([
    supabase.from('projects').select('id, code, name').is('archived_at', null).order('code'),
    supabase.from('vendors').select('id, name').order('name'),
  ])

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <PageHeader title="New bill" back="/bills-booking" subtitle="Enter a contractor (WO) or vendor (PO) bill to start the flow." />
      <BillForm
        projects={(projects ?? []).map(p => ({ id: p.id as string, code: p.code as string, name: p.name as string }))}
        vendors={(vendors ?? []).map(v => ({ id: v.id as string, name: v.name as string }))}
      />
    </div>
  )
}
