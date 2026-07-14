import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkCanSetDeadline, checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { getCcSettings } from '@/lib/cost-control/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { NewWSQuickForm } from './NewWSQuickForm'

export const dynamic = 'force-dynamic'

export default async function NewWorkingSheetQuickPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; discipline?: string; sub_skill?: string }>
}) {
  await requirePermission('cost-control', 'edit')
  const sp = await searchParams
  const supabase = await createClient()

  // Reuse the same project / discipline / sub-skill data the regular New
  // page uses, so engineers see consistent options regardless of mode.
  const { data: projects } = await supabase
    .from('projects')
    .select('id, code, name')
    .not('cc_status', 'is', null)
    .order('code')

  const [pdRes, psRes] = await Promise.all([
    supabase
      .from('cc_project_disciplines')
      .select('project_id, discipline_id, cc_disciplines(id, code, name)')
      .eq('is_enabled', true),
    supabase
      .from('cc_project_sub_skills')
      .select('project_id, sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
      .eq('is_enabled', true),
  ])

  type DRow = { id: string; code: string; name: string }
  type SRow = { id: string; discipline_id: string; code: string; name: string }
  type PDJoin = { project_id: string; cc_disciplines: DRow | DRow[] | null }
  type PSJoin = { project_id: string; cc_sub_skills: SRow | SRow[] | null }

  const projectDisciplines: Array<{ project_id: string; discipline: DRow }> = []
  for (const r of (pdRes.data ?? []) as PDJoin[]) {
    const d = Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines
    if (d) projectDisciplines.push({ project_id: r.project_id, discipline: d })
  }
  const projectSubSkills: Array<{ project_id: string; sub_skill: SRow }> = []
  for (const r of (psRes.data ?? []) as PSJoin[]) {
    const s = Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills
    if (s) projectSubSkills.push({ project_id: r.project_id, sub_skill: s })
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="New Working Sheet — Quick mode"
        subtitle="Attach your Excel and fill only the summary. We'll preview rows and flag rate outliers."
        back={sp.project ? `/cost-control/projects/${sp.project}` : "/cost-control/working-sheets"}
      />
      <Card className="p-5">
        <NewWSQuickForm
          projects={projects ?? []}
          projectDisciplines={projectDisciplines}
          projectSubSkills={projectSubSkills}
          defaultProjectId={sp.project}
          defaultDisciplineId={sp.discipline}
          defaultSubSkillId={sp.sub_skill}
          canSetDeadline={(await checkCanSetDeadline()) && (await getCcSettings()).show_deadlines}
          reviewer={await checkIsCcReviewer()}
        />
      </Card>
    </div>
  )
}
