import { createClient } from '@/lib/supabase/server'
import {
  loadLists, loadItems, loadProjectOptions, loadProjectStaff, loadAssignablePeople, loadUnassignedStock,
} from '@/lib/stores/queries'
import { MastersClient } from './MastersClient'
import { guardStoreTab } from '../guard'

export const dynamic = 'force-dynamic'

export default async function MastersPage() {
  const blocked = await guardStoreTab('masters')
  if (blocked) return blocked

  const supabase = await createClient()
  const [lists, items, { data: companies }, projects, staff, people, unassigned] = await Promise.all([
    loadLists(),
    loadItems(),
    supabase.from('in4_companies').select('id, code, name').order('code'),
    loadProjectOptions(),
    loadProjectStaff(),
    loadAssignablePeople(),
    loadUnassignedStock(),
  ])

  return (
    <MastersClient
      lists={lists}
      items={items}
      companies={(companies ?? []).map(c => ({ id: c.id as number, code: (c.code as string) ?? '', name: c.name as string }))}
      projects={projects}
      staff={staff}
      people={people}
      unassigned={unassigned}
    />
  )
}
