import { createClient } from '@/lib/supabase/server'
import { requireBillsWrite } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { BillForm } from './BillForm'
import { loadPickList } from '@/lib/bills-booking/wo-picker'

export const dynamic = 'force-dynamic'

export default async function NewBillPage() {
  await requireBillsWrite()
  const supabase = await createClient()
  const [{ data: projects }, { data: disciplines }, pick] = await Promise.all([
    supabase.from('projects').select('id, code, name').is('archived_at', null).order('code'),
    supabase.from('cc_disciplines').select('id, name, display_order').eq('is_archived', false).order('display_order'),
    // The work orders themselves, from IN4 — so picking a project narrows them
    // and picking one fills the contractor, the ordered value, what has been
    // billed, the trust and the next RA number.
    loadPickList(supabase).catch(() => ({ wos: [], projects: [] })),
  ])

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <PageHeader title="New bill" back="/bills-booking" subtitle="Enter a contractor (WO) or vendor (PO) bill to start the flow." />
      <BillForm
        projects={(projects ?? []).map(p => ({ id: p.id as string, code: p.code as string, name: p.name as string }))}
        disciplines={(disciplines ?? []).map(d => ({ id: d.id as string, name: d.name as string }))}
        in4Wos={pick.wos}
        in4Projects={pick.projects}
      />
    </div>
  )
}
