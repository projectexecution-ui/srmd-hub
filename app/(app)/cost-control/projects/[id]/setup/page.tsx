import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { AlertTriangle } from 'lucide-react'
import {
  ProjectSetupWizard,
  type ParentProjectOption,
  type UserOption,
  type DisciplineOption,
  type SubSkillOption,
  type DisciplineModePreset,
} from '@/components/ProjectSetupWizard'

export const dynamic = 'force-dynamic'

// "Common 19" — same list as /cost-control/projects/new. We pass it
// through so brand-new tick state is consistent, but for resume the
// already-saved disciplines override the default.
const COMMON_DISCIPLINE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '11', '12', '13', '17', '19',
])

/**
 * Resumable Setup screen. Continues a partially-finished project setup —
 * loads everything saved so far, decides which step to open on, and drops
 * the user into the wizard with state pre-seeded.
 *
 * Reachable from the SetupProgressBanner's "Continue Setup →" button.
 */
export default async function ResumeProjectSetupPage(
  { params }: { params: Promise<{ id: string }> }
) {
  await requirePermission('cost-control', 'edit')
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, code, name, setup_progress_pct, cc_status')
    .eq('id', id)
    .single()

  if (!project) notFound()

  // Used to bounce 100%-complete projects, but PMs need to be able to
  // edit setup after going active (add/remove disciplines, re-tick subs,
  // change engineers). Just open the wizard with everything pre-seeded.
  const isComplete = (project.setup_progress_pct ?? 0) >= 100

  const [parentsRes, usersRes, disciplinesRes, subSkillsRes, projDisRes, projSubRes, assignRes] = await Promise.all([
    supabase.from('projects').select('id, code, name').order('code'),
    supabase.from('profiles').select('id, full_name, name').eq('is_active', true),
    supabase.from('cc_disciplines').select('id, code, name').order('display_order'),
    supabase.from('cc_sub_skills').select('id, discipline_id, code, name').order('code'),
    supabase
      .from('cc_project_disciplines')
      .select('discipline_id, estimation_mode, thumbrule_rate_per_sft, thumbrule_notes')
      .eq('project_id', id)
      .eq('is_enabled', true),
    supabase
      .from('cc_project_sub_skills')
      .select('sub_skill_id')
      .eq('project_id', id)
      .eq('is_enabled', true),
    supabase
      .from('project_assignments')
      .select('user_id, assigned_disciplines')
      .eq('project_id', id)
      .eq('role', 'engineer'),
  ])

  const tablesMissing = !!disciplinesRes.error

  const parentProjects: ParentProjectOption[] = (parentsRes.data ?? []) as ParentProjectOption[]
  const users: UserOption[] = (usersRes.data ?? []).map(p => ({
    id: p.id,
    name: p.full_name ?? p.name ?? '(unnamed)',
  }))
  const disciplines: DisciplineOption[] = (disciplinesRes.data ?? []).map(d => ({
    id: d.id,
    code: d.code,
    name: d.name,
    commonByDefault: COMMON_DISCIPLINE_CODES.has(d.code),
  }))
  const subSkills: SubSkillOption[] = (subSkillsRes.data ?? []) as SubSkillOption[]

  // Saved state for resume
  const savedDisciplineIds = (projDisRes.data ?? []).map(r => r.discipline_id as string)
  const savedDisciplineModes: DisciplineModePreset[] = (projDisRes.data ?? []).map(r => ({
    discipline_id: r.discipline_id as string,
    mode: (r.estimation_mode as 'detailed' | 'thumbrule') ?? 'detailed',
    rate: r.thumbrule_rate_per_sft != null ? String(r.thumbrule_rate_per_sft) : '',
    notes: r.thumbrule_notes ?? '',
  }))
  const savedSubSkillIds = (projSubRes.data ?? []).map(r => r.sub_skill_id as string)
  const savedEngineerPicks = (assignRes.data ?? []).map(a => ({
    user_id: a.user_id as string,
    discipline_ids: (a.assigned_disciplines as string[] | null) ?? [],
  }))

  // Pick the first incomplete step.
  //
  //   step1 done  := project basics row exists (always true at this point)
  //   step2 done  := at least one discipline saved
  //   step3 done  := at least one sub-skill saved
  //   step4 done  := at least one engineer assigned with non-empty disciplines
  //
  // We open the wizard at the first NOT-done step so PMs don't re-tick
  // what's already saved. Always at least Step 2 (basics never resumes).
  let initialStep: 1 | 2 | 3 | 4 = 2
  if (savedDisciplineIds.length > 0) initialStep = 3
  if (savedSubSkillIds.length > 0)    initialStep = 4

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title={isComplete ? `Edit setup — ${project.name}` : `Finish setup — ${project.name}`}
        subtitle={isComplete
          ? 'Add/remove disciplines, sub-skills or engineers. Existing working sheets stay intact.'
          : `${project.setup_progress_pct ?? 0}% complete. Resuming from where you left off.`}
        back={`/cost-control/projects/${id}`}
      />

      {tablesMissing && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 mt-0.5 flex-shrink-0" />
            <p>Cost Control tables not yet applied — disciplines won&apos;t load.</p>
          </div>
        </Card>
      )}

      <ProjectSetupWizard
        parentProjects={parentProjects}
        users={users}
        disciplines={disciplines}
        subSkills={subSkills}
        initialProjectId={id}
        initialStep={initialStep}
        initialPickedDisciplines={savedDisciplineIds}
        initialDisciplineModes={savedDisciplineModes}
        initialPickedSubSkills={savedSubSkillIds}
        initialEngineerPicks={savedEngineerPicks}
      />
    </div>
  )
}
