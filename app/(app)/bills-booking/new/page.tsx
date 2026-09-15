import { createClient } from '@/lib/supabase/server'
import { requireBillsWrite } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { BillForm, type BookingSeed } from './BillForm'
import { loadPickList } from '@/lib/bills-booking/wo-picker'
import { loadBookingMaps } from '@/lib/bills-booking/desks'

export const dynamic = 'force-dynamic'

export default async function NewBillPage() {
  await requireBillsWrite()
  const supabase = await createClient()
  const [{ data: projects }, { data: disciplines }, pick, maps] = await Promise.all([
    supabase.from('projects').select('id, code, name, parent_project_id').is('archived_at', null).order('code'),
    supabase.from('cc_disciplines').select('id, name, display_order').eq('is_archived', false).order('display_order'),
    // The orders themselves, from IN4 — work orders and purchase orders both,
    // so picking one fills the contractor or supplier, the ordered value, what
    // has been billed, the trust and the next RA number.
    loadPickList(supabase).catch(() => ({ wos: [], pos: [], projects: [] })),
    // …and the mapping that says where a work order books and who approves it,
    // so the old "Where it books" step is answered instead of asked.
    loadBookingMaps(supabase),
  ])

  // Maps do not cross the server/client boundary, so they go as entry arrays
  // and are rebuilt once on the other side.
  const seed: BookingSeed = {
    subprojects: [...maps.subprojects],
    linked: [...maps.linked],
    desks: [...maps.desks],
    projectHeads: [...maps.projectHeads],
    people: [...maps.people],
    ctProjects: [...maps.ctProjects],
    skills: [...maps.skills],
    disciplines: [...maps.disciplines],
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-5">
      <PageHeader title="New bill" back="/bills-booking" subtitle="Enter a contractor (WO) or vendor (PO) bill to start the flow." />
      <BillForm
        projects={(projects ?? []).map(p => ({ id: p.id as string, code: p.code as string, name: p.name as string, parent_project_id: p.parent_project_id as string | null }))}
        disciplines={(disciplines ?? []).map(d => ({ id: d.id as string, name: d.name as string }))}
        in4Wos={pick.wos}
        in4Pos={pick.pos}
        in4Projects={pick.projects}
        seed={seed}
        // Every page in this section already requires admin, so anyone who got
        // here can set a desk. The prop stays so it survives the day desk users
        // exist and this stops being true.
        canAdmin
      />
    </div>
  )
}
