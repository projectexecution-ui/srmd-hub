import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { AlertTriangle, FileSpreadsheet } from 'lucide-react'
import {
  ProjectSetupWizard,
  type ParentProjectOption,
  type UserOption,
  type DisciplineOption,
  type SubSkillOption,
  type DisciplineModePreset,
} from '@/components/ProjectSetupWizard'
import { RenameProjectChip } from '../RenameProjectChip'
import { ProjectAliasChip } from '../ProjectAliasChip'
import { AreaChip } from '../AreaChip'
import { ParentProjectControl } from '../ParentProjectControl'
import { ProjectApproversPanel } from '../ProjectApproversPanel'
import { GroupLabelChip } from '@/app/(app)/cost-control/GroupLabelChip'
import { getBphMappingForProject } from '@/app/(app)/cost-control/import/bph/actions'
import { getCcSettings } from '@/lib/cost-control/settings'

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
  // Project setup is a management action — engineers hold cost-control edit
  // for their own sheets, not for this.
  if (!(await checkIsCcReviewer())) redirect('/cost-control')
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, code, name, setup_progress_pct, cc_status, built_up_sft, parent_project_id, group_label')
    .eq('id', id)
    .single()

  if (!project) notFound()

  // Config controls (details / grouping / approvers) are surfaced right here on
  // the setup screen — one management home. Rename/alias/parent are admin-only.
  const isAdmin = (await getMyProfile())?.role === 'admin'
  const ccSettings = await getCcSettings()
  const bphMapping = ccSettings.bph_sync ? await getBphMappingForProject(id) : null

  // Used to bounce 100%-complete projects, but PMs need to be able to
  // edit setup after going active (add/remove disciplines, re-tick subs).
  // Just open the wizard with everything pre-seeded.
  const isComplete = (project.setup_progress_pct ?? 0) >= 100

  const [parentsRes, usersRes, disciplinesRes, subSkillsRes, projDisRes, projSubRes, approverRes] = await Promise.all([
    supabase.from('projects').select('id, code, name, parent_project_id').order('code'),
    supabase.from('profiles').select('id, full_name, name, email, role').eq('is_active', true),
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
    supabase.from('cc_project_approvers').select('role, user_id').eq('project_id', id),
  ])

  const tablesMissing = !!disciplinesRes.error

  type AllProj = { id: string; code: string; name: string; parent_project_id: string | null }
  const allProjects = (parentsRes.data ?? []) as AllProj[]
  const parentProjects: ParentProjectOption[] = allProjects.map(p => ({ id: p.id, code: p.code, name: p.name }))
  // Eligible parents: other top-level projects (plus the current parent, so it
  // always shows even in odd data). Never this project or one of its children.
  const parentOptions = allProjects
    .filter(p => p.id !== id && (p.parent_project_id === null || p.id === project.parent_project_id) && p.parent_project_id !== id)
    .map(p => ({ id: p.id, label: `${p.code} · ${p.name}` }))

  type ProfRow = { id: string; full_name: string | null; name: string | null; email: string | null; role: string }
  const profRows = (usersRes.data ?? []) as ProfRow[]
  const users: UserOption[] = profRows.map(p => ({
    id: p.id,
    name: p.full_name ?? p.name ?? '(unnamed)',
    email: p.email,
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

  // Config-panel inputs (approvers roster).
  const nameById = new Map(profRows.map(p => [p.id, p.full_name ?? p.name ?? '(unnamed)']))
  const projectApprovers = ((approverRes.data ?? []) as Array<{ role: 'project_head' | 'head' | 'founder'; user_id: string }>)
    .map(r => ({ role: r.role, user_id: r.user_id, name: nameById.get(r.user_id) ?? '(user)' }))
  const approverCandidates = profRows.map(p => ({ id: p.id, name: p.full_name ?? p.name ?? '(unnamed)' }))

  // Pick the first incomplete step.
  //
  //   step1 done  := project basics row exists (always true at this point)
  //   step2 done  := at least one discipline saved
  //   step3 done  := at least one sub-skill saved
  //
  // We open the wizard at the first NOT-done step so PMs don't re-tick
  // what's already saved. Always at least Step 2 (basics never resumes).
  let initialStep: 1 | 2 | 3 = 2
  if (savedDisciplineIds.length > 0) initialStep = 3

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title={isComplete ? `Edit setup — ${project.name}` : `Finish setup — ${project.name}`}
        subtitle={isComplete
          ? 'Add/remove disciplines or sub-skills. Existing working sheets stay intact.'
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

      {/* ── Project settings ────────────────────────────────────────────
          Details, grouping, BPH source — the config that used to clutter the
          project page now lives here, on the one management screen. */}
      <Card className="p-4 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">Project details</h2>
          <div className="flex flex-wrap items-center gap-2">
            <RenameProjectChip projectId={id} name={project.name} isAdmin={isAdmin} />
            <ProjectAliasChip projectId={id} code={project.code} isAdmin={isAdmin} />
            <AreaChip projectId={id} sft={project.built_up_sft != null ? Number(project.built_up_sft) : null} canWrite />
          </div>
        </div>

        <div className="border-t border-gray-100 pt-3 space-y-2">
          <h2 className="text-sm font-semibold text-gray-900">Grouping</h2>
          <p className="text-xs text-gray-500">Make this a sub-project of another, or keep it top-level.</p>
          <ParentProjectControl
            projectId={id}
            currentParentId={project.parent_project_id}
            options={parentOptions}
            isAdmin={isAdmin}
          />
          <div className="pt-1">
            <span className="text-xs text-gray-500 mr-2">Group name on the dashboard band:</span>
            <GroupLabelChip projectId={id} label={project.group_label?.trim() || project.code} isAdmin={isAdmin} />
          </div>
        </div>

        {ccSettings.bph_sync && (
          <div className="border-t border-gray-100 pt-3 space-y-1">
            <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
              <FileSpreadsheet className="h-4 w-4 text-gray-400" /> Budget (BPH) source
            </h2>
            {bphMapping ? (
              <p className="text-sm text-gray-700">
                Linked to a BPH report — <span className="text-emerald-700 font-medium">auto-syncs on every BPH upload</span>.{' '}
                <Link href={`/cost-control/import/bph?cc_project=${id}`} className="text-blue-600 hover:underline">Change or resync →</Link>
              </p>
            ) : (
              <p className="text-sm text-gray-700">
                Not linked yet.{' '}
                <Link href={`/cost-control/import/bph?cc_project=${id}`} className="text-blue-600 hover:underline">Map to a BPH report →</Link>{' '}
                Once mapped, Budget (ERP) numbers refresh automatically on every upload.
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Per-project approvers roster. */}
      <ProjectApproversPanel
        projectId={id}
        approvers={projectApprovers}
        candidates={approverCandidates}
        canWrite
      />

      <div className="pt-1">
        <h2 className="text-sm font-semibold text-gray-900">Disciplines &amp; sub-skills</h2>
        <p className="text-xs text-gray-500">Pick what this project estimates.</p>
      </div>

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
      />
    </div>
  )
}
