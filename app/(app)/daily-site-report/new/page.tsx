import { requirePermission, getMyProfile, getMyUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/ui/empty-state'
import { ClipboardCheck, HardHat } from 'lucide-react'
import { ReportForm } from './report-form'

export const dynamic = 'force-dynamic'

type Proj = { id: string; code: string | null; name: string }

export default async function NewSiteReportPage() {
  await requirePermission('daily-site-report', 'edit')
  const [profile, user] = await Promise.all([getMyProfile(), getMyUser()])
  const role = profile?.role
  const canEnter = role === 'admin' || role === 'engineer'

  // Management roles have edit (for follow-up notes) but cannot create reports
  // (RLS insert = admin/engineer). Say so plainly instead of a silent redirect.
  if (!canEnter || !user) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <PageHeader title="Add site report" back="/daily-site-report" />
        <EmptyState
          icon={<HardHat className="h-10 w-10" />}
          title="Only site engineers add reports"
          description="You can view and track every site's deliveries from the Daily Site Report list."
        />
      </div>
    )
  }

  const supabase = await createClient()

  // Assigned projects (admin sees all sites).
  let projects: Proj[] = []
  if (role === 'admin') {
    const { data } = await supabase.from('projects').select('id, code, name').order('name')
    projects = (data ?? []) as Proj[]
  } else {
    const { data } = await supabase
      .from('project_assignments')
      .select('projects ( id, code, name )')
      .eq('user_id', user.id)
    const seen = new Set<string>()
    projects = (data ?? [])
      .map(r => {
        const p = (r as { projects: Proj | Proj[] | null }).projects
        return Array.isArray(p) ? p[0] : p
      })
      .filter((p): p is Proj => !!p && !seen.has(p.id) && !!seen.add(p.id))
      .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name))
  }

  const { data: vendors } = await supabase.from('vendors').select('id, name').order('name')

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <PageHeader
        title="Add site report"
        subtitle="Log a material / supplier delivery"
        back="/daily-site-report"
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-10 w-10" />}
          title="No site assigned to you yet"
          description="Ask an admin to assign you to your site(s) before logging deliveries."
        />
      ) : (
        <ReportForm projects={projects} vendors={vendors ?? []} createdBy={user.id} />
      )}
    </div>
  )
}
