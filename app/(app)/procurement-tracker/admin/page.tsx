import { createClient } from '@/lib/supabase/server'
import { getTrackerSlot } from '@/lib/procurement/tracker-cache'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { ProcurementProjectVisibilityEditor } from './ProcurementProjectVisibilityEditor'
import { ProcurementNotifySettingsForm } from './ProcurementNotifySettingsForm'
import { ClosedProjectsEditor } from './ClosedProjectsEditor'
import { getProcurementNotifyConfig } from '@/lib/procurement/notify-settings'

export const dynamic = 'force-dynamic'

export default async function ProcurementProjectVisibilityPage() {
  // Admin-only. Lives INSIDE the procurement-tracker module (Aksha
  // asked to keep module-specific admin out of the global sidebar
  // and reachable from the module's own header instead — same
  // pattern as /inventory/admin/…).
  // Gated through the permission matrix (admin holds can_admin) so the module's
  // on/off switch applies here too — a bare role check ignored it.
  await requirePermission('procurement-tracker', 'admin', '/procurement-tracker')

  const supabase = await createClient()
  const notifyConfig = await getProcurementNotifyConfig()
  const [
    { data: known },
    { data: users },
    { data: hidden },
    stateRow,
    { data: closedRow },
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
    // Cached at the source — this page was parsing the whole ~803 kB blob just
    // to list project names and the saved-at stamp.
    getTrackerSlot('global', supabase),
    supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'procurement_closed_projects')
      .maybeSingle(),
  ])

  let closedProjects: string[] = []
  try {
    const parsed = JSON.parse((closedRow?.value as string | null) ?? '[]')
    if (Array.isArray(parsed)) closedProjects = parsed.filter((x): x is string => typeof x === 'string')
  } catch { /* malformed — treat as none */ }

  // Merge the auto-grown registry with the projects in the CURRENT upload, so
  // the settings list always reflects live data even if the registry missed a
  // project on some past upload. Registry's last_seen_at wins; live-only
  // projects fall back to the upload's savedAt.
  const state = (stateRow?.state ?? null) as { savedAt?: string; projects?: Array<{ projectName?: string }> } | null
  const savedAt = state?.savedAt ?? new Date().toISOString()
  const byName = new Map<string, string>()
  for (const r of (known ?? []) as Array<{ name: string; last_seen_at: string }>) {
    if (r.name) byName.set(r.name, r.last_seen_at)
  }
  for (const p of state?.projects ?? []) {
    const n = (p?.projectName ?? '').trim()
    if (n && !byName.has(n)) byName.set(n, savedAt)
  }
  const mergedProjects = Array.from(byName, ([name, lastSeenAt]) => ({ name, lastSeenAt }))
    .sort((a, b) => a.name.localeCompare(b.name))

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
        projects={mergedProjects.map(p => p.name)}
      />
      <ClosedProjectsEditor
        allProjects={mergedProjects.map(p => p.name)}
        initialClosed={closedProjects}
      />
      <ProcurementProjectVisibilityEditor
        knownProjects={mergedProjects}
        users={users ?? []}
        initialHiddenRows={(hidden ?? []).map(r => ({ userId: r.user_id as string, projectName: r.project_name as string }))}
      />
    </div>
  )
}
