import { createClient } from '@/lib/supabase/server'
import { loadLists, loadItems, loadProjectOptions } from '@/lib/stores/queries'
import { MastersClient } from './MastersClient'

export const dynamic = 'force-dynamic'

export default async function MastersPage() {
  const supabase = await createClient()
  const [lists, items, { data: companies }, projects] = await Promise.all([
    loadLists(),
    loadItems(),
    supabase.from('in4_companies').select('id, code, name').order('code'),
    loadProjectOptions(),
  ])

  return (
    <MastersClient
      lists={lists}
      items={items}
      companies={(companies ?? []).map(c => ({ id: c.id as number, code: (c.code as string) ?? '', name: c.name as string }))}
      projects={projects}
    />
  )
}
