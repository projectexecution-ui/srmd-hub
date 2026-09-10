import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { ProcurementProjectVisibilityEditor } from './ProcurementProjectVisibilityEditor'

export const dynamic = 'force-dynamic'

/**
 * Who sees which project's indents. The daily follow-up digest and the
 * "closed projects" list left with the upload-based tracker (10 Sep 2026).
 * Project names come from the registry the uploads grew plus IN4's own
 * project list, so the picker keeps working without an upload.
 */
export default async function ProcurementProjectVisibilityPage() {
  await requirePermission('procurement-tracker', 'admin', '/procurement-tracker')

  const supabase = await createClient()
  const [{ data: known }, { data: in4Projects }, { data: users }, { data: hidden }] = await Promise.all([
    supabase.from('procurement_known_projects').select('name, last_seen_at').order('name', { ascending: true }),
    supabase.from('in4_projects').select('name').order('name', { ascending: true }),
    supabase.from('profiles').select('id, full_name, email, role, is_active').eq('is_active', true).order('full_name', { ascending: true }),
    supabase.from('procurement_user_project_visibility').select('user_id, project_name'),
  ])

  const byName = new Map<string, string>()
  for (const r of (known ?? []) as Array<{ name: string; last_seen_at: string }>) if (r.name) byName.set(r.name, r.last_seen_at)
  const now = new Date().toISOString()
  for (const p of (in4Projects ?? []) as Array<{ name: string | null }>) {
    const n = (p.name ?? '').trim()
    if (n && !byName.has(n)) byName.set(n, now)
  }
  const mergedProjects = Array.from(byName, ([name, lastSeenAt]) => ({ name, lastSeenAt })).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title="Procurement — Admin" back="/procurement-tracker" subtitle="Per-user project visibility for indents." />
      <ProcurementProjectVisibilityEditor
        knownProjects={mergedProjects}
        users={users ?? []}
        initialHiddenRows={(hidden ?? []).map(r => ({ userId: r.user_id as string, projectName: r.project_name as string }))}
      />
    </div>
  )
}
