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
  const [{ data: projects }, { data: skills }, pick, maps] = await Promise.all([
    supabase.from('projects').select('id, code, name, parent_project_id, group_label').is('archived_at', null).order('code'),
    // Aksha, 17 Sep 2026: "category and sub category in entering a bill without
    // PO should come of IN4 - also with thier Numbers - also it should be
    // cascading."
    //
    // It is IN4's own skill tree: `in4_skills`, 462 rows, every one carrying a
    // parent. A category is a skill that has children ("03 Civil"), a
    // sub-category is one of those children ("302 Steel Works"). Checked on
    // the work orders: all 1,687 category_ids are skills, and on every one of
    // the 1,410 that also name a sub-category, the sub-category's parent IS
    // the category. So the cascade is IN4's, not one I invented.
    //
    // The numbers stay. Elsewhere the leading number is stripped to match
    // cc_disciplines by name; here it is the thing Aksha asked to see, and it
    // is what the ERP prints.
    supabase.from('in4_skills').select('id, name, parent_id, is_active').eq('is_active', true).order('name'),
    // The orders themselves, from IN4 — work orders and purchase orders both,
    // so picking one fills the contractor or supplier, the ordered value, what
    // has been billed, the trust and the next RA number.
    loadPickList(supabase).catch(() => ({ wos: [], pos: [], projects: [] })),
    // …and the mapping that says where a work order books and who approves it,
    // so the old "Where it books" step is answered instead of asked.
    loadBookingMaps(supabase),
  ])

  // The skill tree, folded into the two levels the form offers. A category is
  // a skill with children; its sub-categories are those children. IN4's own
  // names and numbers, untouched.
  type Skill = { id: number; name: string | null; parent_id: number | null }
  const all = (skills ?? []) as Skill[]
  const kids = new Map<number, Array<{ id: number; name: string }>>()
  for (const s of all) {
    if (s.parent_id == null) continue
    const list = kids.get(s.parent_id)
    const row = { id: s.id, name: (s.name ?? '').trim() }
    if (list) list.push(row); else kids.set(s.parent_id, [row])
  }
  const categories = all
    .filter(s => kids.has(s.id))
    .map(s => ({
      id: s.id,
      name: (s.name ?? '').trim(),
      subs: (kids.get(s.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

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
        projects={(projects ?? []).map(p => ({ id: p.id as string, code: p.code as string, name: p.name as string, parent_project_id: p.parent_project_id as string | null, group_label: p.group_label as string | null }))}
        categories={categories}
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
