import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { ProcurementProjectVisibilityEditor } from './ProcurementProjectVisibilityEditor'
import { ProcurementNotifySettingsForm } from './ProcurementNotifySettingsForm'
import { getProcurementNotifyConfig } from '@/lib/procurement/notify-settings'

export const dynamic = 'force-dynamic'

export default async function ProcurementProjectVisibilityPage() {
  // Admin-only. Lives INSIDE the procurement-tracker module (Aksha
  // asked to keep module-specific admin out of the global sidebar
  // and reachable from the module's own header instead — same
  // pattern as /inventory/admin/…).
  const profile = await getMyProfile()
  if (!profile || profile.role !== 'admin') redirect('/procurement-tracker')

  const supabase = await createClient()
  const notifyConfig = await getProcurementNotifyConfig()
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
        title="Procurement — Admin"
        back="/procurement-tracker"
        subtitle="Daily follow-up email + per-user project visibility. Project names auto-grow from every upload."
      />
      <ProcurementNotifySettingsForm
        initial={notifyConfig}
        users={(users ?? []).map(u => ({ id: u.id as string, full_name: (u.full_name as string | null) ?? null, email: u.email as string, role: u.role as string }))}
        projects={(known ?? []).map(r => r.name as string)}
      />
      <ProcurementProjectVisibilityEditor
        knownProjects={(known ?? []).map(r => ({ name: r.name as string, lastSeenAt: r.last_seen_at as string }))}
        users={users ?? []}
        initialHiddenRows={(hidden ?? []).map(r => ({ userId: r.user_id as string, projectName: r.project_name as string }))}
      />
    </div>
  )
}
