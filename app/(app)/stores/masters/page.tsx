import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { loadLists, loadItems, loadFieldLang } from '@/lib/stores/queries'
import { MastersClient } from './MastersClient'

export const dynamic = 'force-dynamic'

export default async function MastersPage() {
  const supabase = await createClient()
  const [lists, items, fieldLang, profile, { data: companies }, { data: projects }] = await Promise.all([
    loadLists(),
    loadItems(),
    loadFieldLang(),
    getMyProfile(),
    supabase.from('in4_companies').select('id, code, name').order('code'),
    supabase.from('projects').select('id, name').order('name'),
  ])

  return (
    <MastersClient
      lists={lists}
      items={items}
      companies={(companies ?? []).map(c => ({ id: c.id as number, code: (c.code as string) ?? '', name: c.name as string }))}
      projects={(projects ?? []).map(p => ({ id: p.id as string, name: p.name as string }))}
      fieldLang={fieldLang}
      isAdmin={profile?.role === 'admin'}
    />
  )
}
