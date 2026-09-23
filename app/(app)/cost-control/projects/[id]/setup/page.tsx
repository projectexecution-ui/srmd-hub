import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { AlertTriangle, FileSpreadsheet, ChevronRight } from 'lucide-react'
import {
  ProjectSetupWizard,
  type ParentProjectOption,
  type UserOption,
  type DisciplineOption,
  type SubSkillOption,
  type DisciplineModePreset,
} from '@/components/ProjectSetupWizard'
import { ProjectAliasChip } from '../ProjectAliasChip'
import { AreaChip } from '../AreaChip'
import { personName, formatDateTime } from '@/lib/utils'
import { ParentProjectControl, type KindOption } from '../ParentProjectControl'
import { ProjectPeoplePanel } from './ProjectPeoplePanel'
import { mergeGrants } from '@/lib/revamp/project-people'
import { ProjectArchiveControls } from '../ProjectArchiveControls'
import { GroupLabelChip } from '@/app/(app)/cost-control/GroupLabelChip'
import { getBphMappingForProject } from '@/app/(app)/cost-control/import/bph/actions'
import { getCcSettings } from '@/lib/cost-control/settings'
import { CopySetupPanel } from './CopySetupPanel'
import { BphSyncButton } from '../BphSyncButton'
import { IeRevisionPanel, type IeRevision } from '../IeRevisionPanel'
import { checkCanDecideInternalEstimate, checkCanRequestIeRevision } from '@/components/cost-control/ws-actions'
import { listSetupSources } from './copy-setup-actions'
import { kindOf, KIND_LABEL, type ProjectKind } from '@/lib/projects/kind'
import { setupGaps, type SetupGap } from '@/lib/cost-control/setup-status'

export const dynamic = 'force-dynamic'

// "Common 19" — same list as /cost-control/projects/new. We pass it
// through so brand-new tick state is consistent, but for resume the
// already-saved disciplines override the default.
const COMMON_DISCIPLINE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '11', '12', '13', '17', '19',
])

/**
 * Setup — everything about a project that is not a number.
 *
 * Aksha, 23 Sep 2026 (P1): a "Not finished" strip first, then four blocks —
 * Basics · People · Categories · Danger zone. The categories wizard shows in
 * full only while categories are missing; a finished project keeps it behind
 * "Edit categories". Before this the page was the lock panel, one card of
 * mixed settings, the people panel, archive, and then the wizard — with
 * nothing saying what was still missing (the 20 RU sub-projects read "100 %
 * complete" with no Atm Head).
 *
 * Reached from the gear on the Internal Estimate and from the workspace's
 * Setup tab (app/(app)/project/[id]/[...rest] renders this component).
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
    .select('id, code, short_name, name, setup_progress_pct, cc_status, built_up_sft, parent_project_id, group_label, archived_at, project_type')
    .eq('id', id)
    .single()

  if (!project) notFound()
  const kind: ProjectKind = kindOf(project.project_type as string | null)

  const isAdmin = (await getMyProfile())?.role === 'admin'
  const ccSettings = await getCcSettings()
  const bphMapping = ccSettings.bph_sync && kind !== 'group' ? await getBphMappingForProject(id) : null
  const in4Stamp = bphMapping ? await in4BudgetStamp() : null

  const [{ data: lockRaw }, { data: revRow }, canDecideRevision, canRequestRevision] = await Promise.all([
    supabase.rpc('cc_ie_lock_state', { p_project: id }),
    supabase.from('cc_ie_revisions')
      .select('id, status, request_note, requested_by, reopen_note, revised_excel_name, decision_note')
      .eq('project_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    checkCanDecideInternalEstimate(),
    checkCanRequestIeRevision(),
  ])
  const lockState = (lockRaw as 'locked' | 'reopen_requested' | 'unlocked' | 'revision_submitted' | null) ?? 'locked'
  let ieRevision: IeRevision | null = null
  if (revRow && !['approved', 'rejected', 'reopen_denied'].includes(revRow.status as string)) {
    let requesterName: string | null = null
    if (revRow.requested_by) {
      const { data: rp } = await supabase.from('profiles').select('full_name, name').eq('id', revRow.requested_by).maybeSingle()
      requesterName = (rp?.full_name ?? rp?.name ?? null) as string | null
    }
    ieRevision = {
      id: revRow.id as string, status: revRow.status as string,
      request_note: revRow.request_note as string | null,
      requested_by_name: requesterName,
      reopen_note: revRow.reopen_note as string | null,
      revised_excel_name: revRow.revised_excel_name as string | null,
      decision_note: revRow.decision_note as string | null,
    }
  }

  const [allRes, usersRes, disciplinesRes, subSkillsRes, projDisRes, projSubRes, approverRes] = await Promise.all([
    // Every live project with its kind (H1) — the kind picker filters it.
    supabase.from('projects').select('id, code, name, parent_project_id, project_type').is('archived_at', null).order('code'),
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
  const [assignRes, deskRes, desksRes] = await Promise.all([
    supabase.from('project_assignments').select('user_id').eq('project_id', id),
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

  type AllProj = { id: string; code: string; name: string; parent_project_id: string | null; project_type: string | null }
  const allProjects = (allRes.data ?? []) as AllProj[]
  const labelById = new Map(allProjects.map(p => [p.id, p.code || p.name]))
  const parentProjects: ParentProjectOption[] = allProjects.map(p => ({
    id: p.id, code: p.code, name: p.name, kind: kindOf(p.project_type),
    parentLabel: p.parent_project_id ? labelById.get(p.parent_project_id) ?? null : null,
  }))
  const kindOptions: KindOption[] = allProjects
    .filter(p => p.id !== id)
    .map(p => ({ id: p.id, label: `${p.code} · ${p.name}`, kind: kindOf(p.project_type), parentLabel: p.parent_project_id ? labelById.get(p.parent_project_id) ?? null : null }))
  const childKinds = allProjects.filter(p => p.parent_project_id === id).map(p => kindOf(p.project_type))
  const parentRow = project.parent_project_id ? allProjects.find(p => p.id === project.parent_project_id) : null

  type ProfRow = { id: string; full_name: string | null; name: string | null; email: string | null; role: string }
  const profRows = (usersRes.data ?? []) as ProfRow[]
  // Only Atm Heads (role='head') for the wizard's sign-off head picker. The full
  // roster (profRows) still feeds the people panel below.
  const atmHeads: UserOption[] = profRows
    .filter(p => p.role === 'head')
    .map(p => ({ id: p.id, name: p.full_name ?? p.name ?? '(unnamed)', email: p.email }))
  const disciplines: DisciplineOption[] = (disciplinesRes.data ?? []).map(d => ({
    id: d.id, code: d.code, name: d.name, commonByDefault: COMMON_DISCIPLINE_CODES.has(d.code),
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
  const approvers = (approverRes.data ?? []) as Array<{ user_id: string; role: string | null }>
  const peopleRows = mergeGrants(
    profRows.map(p => ({ id: p.id, full_name: p.full_name ?? p.name ?? null, email: p.email ?? null, role: p.role ?? 'viewer' })),
    {
      approvers,
      assignments: (assignRes.data ?? []) as Array<{ user_id: string }>,
      indentViewers: (indentRes ?? []) as Array<{ user_id: string }>,
      deskMembers: (deskRes.data ?? []) as Array<{ user_id: string; desk: string | null }>,
    },
  )
  const peopleCandidates = profRows.map(p => ({ id: p.id, name: personName(p.full_name, p.name, p.email), role: p.role ?? 'viewer' }))
  // Desk names already in use, so the panel offers real choices rather than a
  // free-text box that invents a new desk on every typo.
  const deskNames = [...new Set(
    ((desksRes.data ?? []) as Array<{ desk: string | null }>).map(d => d.desk?.trim()).filter(Boolean) as string[],
  )].sort()
  if (deskNames.length === 0) deskNames.push('Site Head')

  // Projects that already have a setup worth reusing (richest first).
  const setupSources = kind === 'group' ? [] : await listSetupSources(id)

  // What is still missing — the one definition, shared with the Projects door.
  const gaps = setupGaps({
    kind,
    atmHeads: approvers.filter(a => a.role === 'head').length,
    areaSft: project.built_up_sft != null ? Number(project.built_up_sft) : null,
    in4Linked: !!bphMapping,
    in4Available: ccSettings.bph_sync,
    disciplines: savedDisciplineIds.length,
    subSkills: savedSubSkillIds.length,
  })
  const categoriesMissing = gaps.some(g => g.block === 'categories')

  // Open the wizard at the first NOT-done step: step 2 unless disciplines are saved.
  const initialStep: 1 | 2 | 3 = savedDisciplineIds.length > 0 ? 3 : 2

  const wizard = (
    <>
      <CopySetupPanel targetProjectId={id} targetProjectName={project.name} sources={setupSources} />
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
    </>
  )

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title={`Setup — ${project.name}`}
        subtitle={`${KIND_LABEL[kind]}${parentRow ? ` under ${parentRow.code || parentRow.name}` : kind === 'group' ? '' : ', standing on its own'} · everything about this project that is not a number.`}
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

      <NotFinished gaps={gaps} />

      {/* ── Basics ─────────────────────────────────────────────────────── */}
      <Block id="basics" title="Basics" hint="Name, area, what kind of project this is and what it sits under, and where its IN4 figures come from.">
        <div className="flex flex-wrap items-center gap-2">
          <ProjectAliasChip projectId={id} code={project.code} shortName={(project as { short_name?: string | null }).short_name ?? null} isAdmin={isAdmin} />
          {kind !== 'group' && <AreaChip projectId={id} sft={project.built_up_sft != null ? Number(project.built_up_sft) : null} canWrite />}
        </div>
        <div className="border-t border-gray-100 pt-3 space-y-2">
          <p className="text-xs text-gray-500">Kind and grouping — Group → Project → Sub-project.</p>
          <ParentProjectControl
            projectId={id}
            kind={kind}
            currentParentId={project.parent_project_id}
            options={kindOptions}
            childKinds={childKinds}
            isAdmin={isAdmin}
          />
          {kind !== 'subproject' && (
            <div className="pt-1">
              <span className="text-xs text-gray-500 mr-2">Group name on the dashboard band:</span>
              <GroupLabelChip projectId={id} label={project.group_label?.trim() || project.code} isAdmin={isAdmin} />
            </div>
          )}
        </div>

        {ccSettings.bph_sync && kind !== 'group' && (
          <div className="border-t border-gray-100 pt-3 space-y-1">
            <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
              <FileSpreadsheet className="h-4 w-4 text-gray-400" /> Budget source: IN4
            </h3>
            {bphMapping ? (
              <>
                <p className="text-sm text-gray-700">
                  Linked to IN4 — <span className="text-emerald-700 font-medium">Budget (ERP) figures refresh twice a day{in4Stamp ? ` · last ${in4Stamp}` : ''}</span>.{' '}
                  <Link href={`/cost-control/import/bph?cc_project=${id}`} className="text-blue-600 hover:underline">Change which IN4 sub-projects feed this project →</Link>
                </p>
                <div className="pt-1"><BphSyncButton projectId={id} isMapped /></div>
              </>
            ) : (
              <p className="text-sm text-gray-700">
                Not linked to IN4 yet.{' '}
                <Link href={`/cost-control/import/bph?cc_project=${id}`} className="text-blue-600 hover:underline">Link this project to its IN4 sub-projects →</Link>{' '}
                Once linked, Budget (ERP) figures refresh from IN4 twice a day.
              </p>
            )}
          </div>
        )}
      </Block>

      {/* ── People ─────────────────────────────────────────────────────── */}
      <Block id="people" title="People" hint="Who signs, who works here, who sees its indents, who holds its bills desk.">
        {kind === 'group'
          ? <p className="text-sm text-gray-500">A group has no people of its own — set them on each project under it.</p>
          : <ProjectPeoplePanel projectId={id} rows={peopleRows} candidates={peopleCandidates} desks={deskNames} canWrite />}
      </Block>

      {/* ── Categories ─────────────────────────────────────────────────── */}
      <Block id="categories" title="Categories" hint="The work categories and sub-skills this project estimates, and the estimate lock.">
        {kind === 'group' ? (
          <p className="text-sm text-gray-500">A group has no categories of its own — its projects do.</p>
        ) : (
          <>
            {/* The Internal Estimate lock and its revision workflow. Whoever
                changes a category needs to know whether the baseline is locked. */}
            <IeRevisionPanel
              projectId={id}
              lockState={lockState}
              revision={ieRevision}
              canRequest={ccSettings.ie_review && canRequestRevision}
              canDecide={ccSettings.ie_review && canDecideRevision}
            />
            {categoriesMissing ? (
              <div className="space-y-4">
                <p className="text-xs text-gray-500">Pick what this project estimates — or copy it from a project you have already set up.</p>
                {wizard}
              </div>
            ) : (
              <details className="group rounded-lg border border-gray-200">
                <summary className="list-none cursor-pointer select-none flex items-center gap-2 px-3 py-2.5 min-h-[44px] text-sm font-medium text-gray-800 [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" />
                  Edit categories and sub-skills
                  <span className="ml-auto text-[11px] font-normal text-gray-400 tabular-nums">{savedDisciplineIds.length} categories · {savedSubSkillIds.length} sub-skills</span>
                </summary>
                <div className="border-t border-gray-100 p-3 space-y-4">
                  <p className="text-xs text-gray-500">Add or remove — existing working sheets stay intact.</p>
                  {wizard}
                </div>
              </details>
            )}
          </>
        )}
      </Block>

      {/* ── Danger zone ────────────────────────────────────────────────── */}
      <Block id="danger" title="Danger zone" hint="Archive hides it everywhere and can be undone; delete cannot." tone="danger">
        <ProjectArchiveControls
          projectId={id}
          projectName={project.name}
          isArchived={!!(project as { archived_at?: string | null }).archived_at}
          canDelete={isAdmin}
        />
      </Block>
    </div>
  )
}

/** What is still missing, as chips that jump to the block that fixes it. */
function NotFinished({ gaps }: { gaps: SetupGap[] }) {
  if (gaps.length === 0) {
    return (
      <p className="rounded-r-xl border-l-4 border-emerald-500 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900">
        Finished — this project has what it needs to work.
      </p>
    )
  }
  return (
    <section aria-label="Not finished" className="rounded-r-xl border-l-4 border-amber-500 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-950">Not finished</p>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {gaps.map(g => (
          <li key={g.key}>
            <a href={`#${g.block}`} title={g.why} className="inline-flex items-center min-h-[32px] px-2.5 rounded-full border border-amber-300 bg-white text-[12.5px] font-medium text-amber-900 hover:bg-amber-100">
              {g.label} <span className="ml-1 font-normal text-amber-700">· {g.why}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Block({ id, title, hint, tone, children }: { id: string; title: string; hint: string; tone?: 'danger'; children: React.ReactNode }) {
  return (
    <Card id={id} className={`p-4 space-y-3 scroll-mt-20 ${tone === 'danger' ? 'border-rose-200' : ''}`}>
      <div>
        <h2 className={`text-sm font-semibold ${tone === 'danger' ? 'text-rose-800' : 'text-gray-900'}`}>{title}</h2>
        <p className="text-xs text-gray-500">{hint}</p>
      </div>
      {children}
    </Card>
  )
}

/** "10 Sep 2026, 09:23" from the IN4 budget feed's last successful run, or null. */
async function in4BudgetStamp(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.from('app_settings').select('value').eq('key', 'in4_last_sync').maybeSingle()
  if (!data?.value) return null
  try {
    const s = JSON.parse(String(data.value)) as { at?: string; ok?: boolean }
    return s.ok && s.at ? formatDateTime(s.at) : null
  } catch { return null }
}
