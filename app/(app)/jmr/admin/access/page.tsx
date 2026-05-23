import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { AccessMatrix } from './access-matrix'

export const dynamic = 'force-dynamic'

export default async function JmrAccessPage() {
  await requirePermission('jmr-admin', 'view')
  const supabase = await createClient()

  // Site engineers / site_staff that need project assignment, plus contractor profiles.
  const [profilesRes, projectsRes, accessRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, role')
      .in('role', ['engineer', 'site_staff', 'contractor'])
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('projects')
      .select('id, name, code')
      .is('parent_project_id', null)
      .order('name'),
    supabase
      .from('jmr_user_project_access')
      .select('user_id, project_id'),
  ])

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-800">Per-user project access</h2>
        <p className="text-xs text-gray-500 mt-1">
          Tick a checkbox to grant a Site Engineer / Site Staff access to a project. Users with no rows assigned see all projects (legacy default).
        </p>
      </div>
      <AccessMatrix
        users={profilesRes.data ?? []}
        projects={projectsRes.data ?? []}
        initialAccess={accessRes.data ?? []}
      />
    </Card>
  )
}
