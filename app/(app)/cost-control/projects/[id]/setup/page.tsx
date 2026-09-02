import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile, getMyPermissions, can } from '@/lib/auth'
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
import { ProjectPeoplePanel } from './ProjectPeoplePanel'
import { mergeGrants } from '@/lib/revamp/project-people'
import { ProjectArchiveControls } from '../ProjectArchiveControls'
import { GroupLabelChip } from '@/app/(app)/cost-control/GroupLabelChip'
import { getBphMappingForProject } from '@/app/(app)/cost-control/import/bph/actions'
import { getCcSettings } from '@/lib/cost-control/settings'
import { CopySetupPanel } from './CopySetupPanel'
import { listSetupSources } from './copy-setup-actions'

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
    .select('id, code, name, setup_progress_pct, cc_status, built_up_sft, parent_project_id, group_label, archived_at')
    .eq('id', id)
    .single()

  if (!project) notFound()

  // Config controls (details / grouping / approvers) are surfaced right here on
  // the setup screen — one management home. Alias/parent stay admin-only; the
  // NAME can be changed by any Cost-Control admin or coordinator (e.g. Parimal).
  const isAdmin = (await getMyProfile())?.role === 'admin'
  const canRename = can(await getMyPermissions(), 'cost-control', 'admin')
  const ccSettings = await getCcSettings()
  const bphMapping = ccSettings.bph_sync ? await getBphMappingForProject(id) : null

  // Used to bounce 100%-complete projects, but PMs need to be able to
  // edit setup after going active (add/remove disciplines, re-tick subs).
  // Just open the wizard with everything pre-seeded.
  const isComplete = (project.setup_progress_pct ?? 0) >= 100

  const [parentsRes, usersRes, disciplinesRes, subSkillsRes, projDisRes, projSubRes, approverRes] = await Promise.all([
    // Parent picker = TOP-LEVEL projects only (a sub-project can't be a parent).
    supabase.from('projects').select('id, code, name, parent_project_id').is('parent_project_id', null).is('archived_at', null).order('code'),
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

  // "Who works on this project" reads all six tables that answer that question,
  // so the whole picture is on one screen instead of five. Each is optional —
  // a module that has never been set up simply contributes nothing.
  const [assignRes, jmrRes, deskRes, desksRes] = await Promise.all([
    supabase.from('project_assignments').select('user_id').eq('project_id', id),
    supabase.from('jmr_user_project_access').select('user_id').eq('project_id', id),
    supabase.from('bb_desk_members').select('user_id, desk').eq('project_id', id),
    supabase.from('bb_desk_members').select('desk'),
  ])
  // Indent visibility is keyed on the project NAME rather than its id — the one
  // fragile grant of the six, and the panel says so on screen.
  const { data: indentRes } = await supabase
    .from('procurement_user_project_visibility')
    .select('user_id')
    .eq('project_name', project.name)

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
  // Only Atm Heads (role='head') for the wizard's sign-off head picker. The full
  // roster (profRows) still feeds the approver config panel below.
  const atmHeads: UserOption[] = profRows
    .filter(p => p.role === 'head')
    .map(p => ({
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

  // Fold the six sources into one row per person. mergeGrants drops a grant
  // whose account no longer exists rather than throwing, so a stale row left by
  // a deleted user cannot take this page down.
  const peopleRows = mergeGrants(
    profRows.map(p => ({
      id: p.id,
      full_name: p.full_name ?? p.name ?? null,
      email: p.email ?? null,
      role: p.role ?? 'viewer',
    })),
    {
      approvers: (approverRes.data ?? []) as Array<{ user_id: string; role: string | null }>,
      assignments: (assignRes.data ?? []) as Array<{ user_id: string }>,
      jmrAccess: (jmrRes.data ?? []) as Array<{ user_id: string }>,
      indentViewers: (indentRes ?? []) as Array<{ user_id: string }>,
      deskMembers: (deskRes.data ?? []) as Array<{ user_id: string; desk: string | null }>,
    },
  )
  const peopleCandidates = profRows.map(p => ({
    id: p.id,
    name: p.full_name ?? p.name ?? p.email ?? '(unnamed)',
    role: p.role ?? 'viewer',
  }))
  // Desk names already in use, so the panel offers real choices rather than a
  // free-text box that invents a new desk on every typo.
  const deskNames = [...new Set(
    ((desksRes.data ?? []) as Array<{ desk: string | null }>).map(d => d.desk?.trim()).filter(Boolean) as string[],
  )].sort()
  if (deskNames.length === 0) deskNames.push('Site Head')

  // Projects that already have a setup worth reusing (richest first).
  const setupSources = await listSetupSources(id)

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
            <RenameProjectChip projectId={id} name={project.name} canRename={canRename} />
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

      {/* Everyone on this project and what each may do — approvals, site
          access, indents and bill desks together. Replaces the trip to five
          screens that used to be the only way to see this. */}
      <ProjectPeoplePanel
        projectId={id}
        rows={peopleRows}
        candidates={peopleCandidates}
        desks={deskNames}
        canWrite
      />

      {/* Archive (soft) / restore / delete. Coordinators archive a mistaken
          project; only an admin restores or permanently deletes. */}
      <ProjectArchiveControls
        projectId={id}
        projectName={project.name}
        isArchived={!!(project as { archived_at?: string | null }).archived_at}
        canDelete={isAdmin}
      />

      <div className="pt-1">
        <h2 className="text-sm font-semibold text-gray-900">Disciplines &amp; sub-skills</h2>
        <p className="text-xs text-gray-500">Pick what this project estimates — or copy it from a project you have already set up.</p>
      </div>

      <CopySetupPanel
        targetProjectId={id}
        targetProjectName={project.name}
        sources={setupSources}
      />

      <ProjectSetupWizard
        parentProjects={parentProjects}
        atmHeads={atmHeads}
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
