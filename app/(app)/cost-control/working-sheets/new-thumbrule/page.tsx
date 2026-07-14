import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkCanSetDeadline } from '@/components/cost-control/ws-actions'
import { getCcSettings } from '@/lib/cost-control/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { NewWSThumbruleForm } from './NewWSThumbruleForm'

export const dynamic = 'force-dynamic'

export default async function NewWSThumbrulePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; discipline?: string; sub_skill?: string }>
}) {
  await requirePermission('cost-control', 'edit')
  const sp = await searchParams
  const supabase = await createClient()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, code, name, built_up_sft')
    .not('cc_status', 'is', null)
    .order('code')

  // Only thumbrule-flagged disciplines show up here. Each carries the
  // default rate-per-sft the HOD set during project setup; the engineer
  // can override per-WS if needed.
  const [pdRes, psRes] = await Promise.all([
    supabase
      .from('cc_project_disciplines')
      .select('project_id, estimation_mode, thumbrule_rate_per_sft, thumbrule_notes, cc_disciplines(id, code, name)')
      .eq('is_enabled', true)
      .eq('estimation_mode', 'thumbrule'),
    supabase
      .from('cc_project_sub_skills')
      .select('project_id, sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
      .eq('is_enabled', true),
  ])

  type DRow = { id: string; code: string; name: string }
  type SRow = { id: string; discipline_id: string; code: string; name: string }
  type PDJoin = {
    project_id: string
    estimation_mode: string | null
    thumbrule_rate_per_sft: number | null
    thumbrule_notes: string | null
    cc_disciplines: DRow | DRow[] | null
  }
  type PSJoin = { project_id: string; cc_sub_skills: SRow | SRow[] | null }

  const projectDisciplines: Array<{
    project_id: string; discipline: DRow; rate_per_sft: number | null; notes: string | null
  }> = []
  for (const r of (pdRes.data ?? []) as PDJoin[]) {
    const d = Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines
    if (!d) continue
    projectDisciplines.push({
      project_id: r.project_id,
      discipline: d,
      rate_per_sft: r.thumbrule_rate_per_sft != null ? Number(r.thumbrule_rate_per_sft) : null,
      notes: r.thumbrule_notes,
    })
  }

  const projectSubSkills: Array<{ project_id: string; sub_skill: SRow }> = []
  for (const r of (psRes.data ?? []) as PSJoin[]) {
    const s = Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills
    if (s) projectSubSkills.push({ project_id: r.project_id, sub_skill: s })
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <PageHeader
        title="Thumbrule estimate"
        subtitle="No drawings yet — estimate by rate-per-sft × built-up area"
        back={sp.project ? `/cost-control/projects/${sp.project}` : "/cost-control/working-sheets"}
      />
      <Card className="p-5">
        <NewWSThumbruleForm
          projects={(projects ?? []).map(p => ({ id: p.id, code: p.code, name: p.name, built_up_sft: p.built_up_sft != null ? Number(p.built_up_sft) : null }))}
          projectDisciplines={projectDisciplines}
          projectSubSkills={projectSubSkills}
          defaultProjectId={sp.project}
          defaultDisciplineId={sp.discipline}
          defaultSubSkillId={sp.sub_skill}
          canSetDeadline={(await checkCanSetDeadline()) && (await getCcSettings()).show_deadlines}
        />
      </Card>
    </div>
  )
}
