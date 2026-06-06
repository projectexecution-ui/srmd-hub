import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { DisciplinesAdmin } from './DisciplinesAdmin'

export const dynamic = 'force-dynamic'

export default async function DisciplinesAdminPage() {
  await requirePermission('cost-control', 'admin', '/cost-control')
  const supabase = await createClient()

  const [discRes, subRes] = await Promise.all([
    supabase.from('cc_disciplines')
      .select('id, code, name, display_order, is_archived')
      .order('display_order'),
    supabase.from('cc_sub_skills')
      .select('id, discipline_id, code, name, default_uom, is_archived')
      .order('code'),
  ])

  // Usage counts so admin sees risk before archiving / renaming
  const [pdRes, psRes] = await Promise.all([
    supabase.from('cc_project_disciplines').select('discipline_id', { head: false }),
    supabase.from('cc_project_sub_skills').select('sub_skill_id', { head: false }),
  ])
  const discProjectCount = new Map<string, number>()
  for (const r of pdRes.data ?? []) {
    discProjectCount.set(r.discipline_id, (discProjectCount.get(r.discipline_id) ?? 0) + 1)
  }
  const subProjectCount = new Map<string, number>()
  for (const r of psRes.data ?? []) {
    subProjectCount.set(r.sub_skill_id, (subProjectCount.get(r.sub_skill_id) ?? 0) + 1)
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Disciplines master"
        subtitle="Manage the catalogue of disciplines + sub-skills used by every Cost Control project"
        back="/cost-control"
      />
      <Card className="p-4 bg-blue-50/50 border-blue-200 text-sm text-blue-900">
        Disciplines here are <b>portfolio-wide</b>. Each project still ticks which ones apply via the
        setup wizard. Archive (don&apos;t delete) a discipline that you stop using — past projects
        keep their history intact.
      </Card>
      <DisciplinesAdmin
        disciplines={(discRes.data ?? []).map(d => ({
          ...d,
          usedInProjects: discProjectCount.get(d.id) ?? 0,
        }))}
        subSkills={(subRes.data ?? []).map(s => ({
          ...s,
          usedInProjects: subProjectCount.get(s.id) ?? 0,
        }))}
      />
    </div>
  )
}
