import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { EntryForm } from './entry-form'
import { TodayEntries } from './today-entries'
import { getJmrSettings } from '@/lib/jmr/settings'

export const dynamic = 'force-dynamic'

export default async function JmrEntryPage() {
  await requirePermission('jmr', 'edit')
  const profile = await getMyProfile()
  const settings = await getJmrSettings()
  const supabase = await createClient()

  // Top-level projects only — sub-projects are loaded once a project is picked.
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, code')
    .is('parent_project_id', null)
    .order('name')

  const { data: contractors } = await supabase
    .from('jmr_contractors')
    .select('id, name')
    .eq('status', 'active')
    .order('name')

  const { data: items } = await supabase
    .from('jmr_items')
    .select('id, name, category, unit')
    .eq('is_active', true)
    .order('category')
    .order('name')

  return (
    <div className="p-3 md:p-6 max-w-md mx-auto">
      <PageHeader title="Daily Entry" subtitle="Log machine hours or manpower" back="/jmr" />
      <EntryForm
        userName={profile?.full_name ?? profile?.email ?? 'Site engineer'}
        projects={projects ?? []}
        contractors={contractors ?? []}
        items={items ?? []}
      />
      <TodayEntries editWindowHours={settings.entry_edit_window_hours} />
    </div>
  )
}
