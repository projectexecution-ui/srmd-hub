import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { ProcurementProjectVisibilityEditor } from './ProcurementProjectVisibilityEditor'

export const dynamic = 'force-dynamic'

export default async function ProcurementProjectVisibilityPage() {
  // Admin-only — Portal Owners are admins too via role check elsewhere,
  // but for project visibility we keep it strictly to role='admin'.
  const profile = await getMyProfile()
  if (!profile || profile.role !== 'admin') redirect('/admin')

  const supabase = await createClient()
  const [
    { data: known },
    { data: users },
    { data: hidden },
  ] = await Promise.all([
    supabase
      .from('procurement_known_projects')
      .select('name, last_seen_at')
      .order('name', { ascending: true }),
    supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active')
      .eq('is_active', true)
      .order('full_name', { ascending: true }),
    supabase
      .from('procurement_user_project_visibility')
      .select('user_id, project_name'),
  ])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Procurement — Project Visibility"
        back="/admin"
        subtitle="Hide individual projects from individual users. Default is show-everything; row exists ⇒ hidden for that user. Names auto-grow from every upload."
      />
      <ProcurementProjectVisibilityEditor
        knownProjects={(known ?? []).map(r => ({ name: r.name as string, lastSeenAt: r.last_seen_at as string }))}
        users={users ?? []}
        initialHiddenRows={(hidden ?? []).map(r => ({ userId: r.user_id as string, projectName: r.project_name as string }))}
      />
    </div>
  )
}
