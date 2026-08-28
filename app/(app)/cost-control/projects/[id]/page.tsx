import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { checkIsCcReviewer, checkCanDecideInternalEstimate, checkCanRequestIeRevision } from '@/components/cost-control/ws-actions'
import { IeRevisionPanel, type IeRevision } from './IeRevisionPanel'
import { EngineerProjectView } from './EngineerProjectView'
import { PageHeader } from '@/components/PageHeader'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { SetupProgressBanner } from '@/components/ProjectSetupWizard/SetupProgressBanner'
import { Plus, Flame, Info, Settings, Download, Ruler, ArrowRight } from 'lucide-react'
import { formatINR, istCalendarDaysAgo } from '@/lib/utils'
import { getCcSettings } from '@/lib/cost-control/settings'
import { computeMoneyRollup, type RollupWSRow, type RollupVersionRow, type RollupBudgetLine } from '@/lib/cost-control/project-rollup'
import { sortDisciplines } from '@/lib/cost-control/discipline-order'
import { overBudgetAmount, overBudgetDriver } from '@/lib/cost-control/over-budget'
import { canMarkComplete, savingsOnCompletion } from '@/lib/cost-control/completion'
import { ccApprovalPath } from '@/lib/cost-control/approval-link'
import { estimateShortfall, hasNoEstimate } from '@/lib/cost-control/estimate-vs-erp'
import { CompleteControl } from './CompleteControl'
import { ProjectAlerts } from './ProjectAlerts'
import { AddToProject } from './AddToProject'
import { QueryError } from '@/components/ui/query-error'
import { DeadlineBadge } from '@/components/cost-control/DeadlineBadge'
import { TreeProvider, TreeToolbar, CatChevron, CatRows, SubRow, RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { FocusScroll } from '@/components/cost-control/FocusScroll'
import { wsStatusLabel } from '@/components/cost-control/WSStatusPill'
import { SubSkillBoq, type BoqRow, type BoqSheet } from '@/components/cost-control/SubSkillBoq'
import { DeadlineCell, SubSkillModeCell, DisableButton, InternalEstimateDecision, RowConfigMenu, RowConfigItem } from './RowControls'
import { BphSyncButton } from './BphSyncButton'
import { getBphMappingForProject } from '@/app/(app)/cost-control/import/bph/actions'

export const dynamic = 'force-dynamic'

interface DisciplineRow { id: string; code: string; name: string; display_order: number }
interface SubSkillRow  { id: string; discipline_id: string; code: string; name: string }
interface BudgetLine {
  discipline_id: string
  sub_skill_id: string | null
  line_type: string | null
  current_budget_amt: number | null
  current_wo_committed_amt: number | null
  current_paid_amt: number | null
  internal_estimate_amt: number | null
  internal_estimate_set_at: string | null
  internal_estimate_notes: string | null
}
interface WSAgg {
  id: string
  discipline_id: string
  sub_skill_id: string
  status: string
  total_amount: number | null
  approved_for_erp_amt: number | null
  deadline_date: string | null
  entry_mode: 'line_items' | 'excel_summary' | 'thumbrule' | null
  summary_notes: string | null
  in4_entered_at: string | null
  submitted_at: string | null
  is_adhoc: boolean | null
}

export default async function CostControlProjectDetailPage(
  { params, searchParams }: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ focus_disc?: string; focus_sub?: string; ws?: string }>
  }
) {
  const perms = await requirePermission('cost-control', 'view')
  const { id } = await params
  const ccLabel = labelFor(await getModuleLabels(), 'cost-control') // configurable module name (e.g. "Internal Estimate")
  // Deep-link from an approval review: open ONLY this category, highlight this
  // sub-skill, keep everything else collapsed so the reviewer isn't lost in a
  // wall of rows. `ws` names the exact sheet he came to sign off — every
  // approval link (home inbox, My Approvals, the bell, the email) now lands
  // here rather than on the bare voucher, so he judges the ask against the
  // project before opening it.
  const { focus_disc: focusDisc, focus_sub: focusSub, ws: focusWs } = await searchParams

  const supabase = await createClient()
  const ccSettings = await getCcSettings()
  const reviewer = await checkIsCcReviewer()
  // Only the Trustee (founder) / Admin may accept or reject the Internal
  // Estimate baseline — and only when the (off-by-default) review toggle is
  // on. Off: the uploaded estimate is simply the baseline, no manual step.
  const canDecideRevision = await checkCanDecideInternalEstimate() // Trustee/Admin
  const canDecideIE = ccSettings.ie_review && canDecideRevision
  const canRequestRevision = await checkCanRequestIeRevision()      // Atm/PH/Admin

  // Internal Estimate lock + any in-flight revision.
  const [{ data: lockRaw }, { data: revRow }] = await Promise.all([
    supabase.rpc('cc_ie_lock_state', { p_project: id }),
    supabase.from('cc_ie_revisions')
      .select('id, status, request_note, requested_by, reopen_note, revised_excel_name, decision_note')
      .eq('project_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
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

  // Non-reviewers get routed away from the Internal Estimate below — see the
  // engineer branch right after the project loads.
  // Setup / disable / deadline / BPH-sync controls are management-only even
  // when an engineer is allowed to view.
  const canWrite = can(perms, 'cost-control', 'edit') && reviewer
  // Adding a work category / sub-category mints a code in the ONE master list
  // shared by every project, so it stays with admin / Trustee / coordinator —
  // Atm Heads hold can_edit but not can_admin. (HOD #6)
  const canAddStructure = can(perms, 'cost-control', 'admin')
  // ERP columns + spend KPIs (engineers never reach this page — they get
  // the EngineerProjectView below).
  const showErp = ccSettings.show_erp_columns

  const { data: project, error: projectErr } = await supabase
    .from('projects')
    .select('id, code, name, description, cc_status, setup_progress_pct, built_up_sft, parent_project_id, pm_user_id, start_date, target_completion')
    .eq('id', id)
    .single()

  // PGRST116 = .single() found no row → the project genuinely doesn't
  // exist. Anything else is a transient failure — say so instead of
  // showing a misleading 404.
  if (projectErr && projectErr.code !== 'PGRST116') {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-2 text-xs">
          <Link href="/cost-control" className="text-blue-600 hover:underline">← {ccLabel}</Link>
        </div>
        <QueryError message={projectErr.message} what="this project" />
      </div>
    )
  }
  if (!project) notFound()

  // Engineers never see the Internal Estimate. A non-reviewer gets a
  // SEPARATE, safe view (the management-style category/sub-skill table minus
  // Internal Estimate / Paid / % Used) — reached by opening one of their
  // projects from the Cost Control home.
  if (!reviewer) {
    return <EngineerProjectView project={{ id: project.id, code: project.code, name: project.name, built_up_sft: project.built_up_sft }} />
  }

  // Parent project name + pm name + everything else in parallel
  const [parentRes, pmRes, projDisRes, projSubRes, blRes, wsRes, assignRes, profilesRes] = await Promise.all([
    project.parent_project_id
      ? supabase.from('projects').select('id, code, name').eq('id', project.parent_project_id).single()
      : Promise.resolve({ data: null }),
    project.pm_user_id
      ? supabase.from('profiles').select('id, full_name, name').eq('id', project.pm_user_id).single()
      : Promise.resolve({ data: null }),
    supabase
      .from('cc_project_disciplines')
      .select('discipline_id, estimation_mode, thumbrule_rate_per_sft, thumbrule_notes, target_deadline, cc_disciplines(id, code, name, display_order)')
      .eq('project_id', id)
      .eq('is_enabled', true),
    supabase
      .from('cc_project_sub_skills')
      .select('sub_skill_id, estimation_mode, thumbrule_rate_per_sft, thumbrule_notes, target_deadline, completed_at, completed_by, cc_sub_skills(id, discipline_id, code, name)')
      .eq('project_id', id)
      .eq('is_enabled', true),
    supabase
      .from('cc_budget_lines')
      .select('discipline_id, sub_skill_id, line_type, current_budget_amt, current_wo_committed_amt, current_paid_amt, internal_estimate_amt, internal_estimate_set_at, internal_estimate_notes')
      .eq('project_id', id),
    supabase
      .from('cc_working_sheets')
      .select('id, discipline_id, sub_skill_id, status, total_amount, approved_for_erp_amt, deadline_date, entry_mode, summary_notes, in4_entered_at, submitted_at, is_adhoc')
      .eq('project_id', id)
      .is('archived_at', null),
    supabase
      .from('project_assignments')
      .select('user_id, role, assigned_disciplines')
      .eq('project_id', id)
      .eq('role', 'engineer'),
    supabase.from('profiles').select('id, full_name, name'),
  ])

  // Version-chain identity (anchor + version_no) for this project's live
  // sheets. Only the versions view computes these; the base table can't.
  // Used to collapse each revision chain to its latest live version so the
  // Internal Estimate never counts the same sheet's older versions again.
  const verRes = await supabase
    .from('cc_ws_with_versions')
    .select('id, chain_anchor_id, version_no')
    .eq('project_id', id)
    .is('archived_at', null)

  // Budget lines + working sheets drive every number on this page. If
  // either query broke, zeros would masquerade as "no budget yet" — stop
  // and say so instead.
  if (blRes.error || wsRes.error) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-2 text-xs">
          <Link href="/cost-control" className="text-blue-600 hover:underline">← {ccLabel}</Link>
        </div>
        <PageHeader title={project.name} subtitle={project.code} className="mb-0" />
        {blRes.error && <QueryError message={blRes.error.message} what="this project's budget lines" />}
        {wsRes.error && <QueryError message={wsRes.error.message} what="this project's working sheets" />}
      </div>
    )
  }

  // Flatten the joined disciplines / sub-skills
  type ProjDisJoin = {
    discipline_id: string
    estimation_mode: 'detailed' | 'thumbrule' | null
    thumbrule_rate_per_sft: number | null
    thumbrule_notes: string | null
    target_deadline: string | null
    cc_disciplines: DisciplineRow | DisciplineRow[] | null
  }
  type ProjSubJoin = {
    sub_skill_id: string
    estimation_mode: 'detailed' | 'thumbrule' | null
    thumbrule_rate_per_sft: number | null
    thumbrule_notes: string | null
    target_deadline: string | null
    completed_at: string | null
    completed_by: string | null
    cc_sub_skills: SubSkillRow | SubSkillRow[] | null
  }

  const disciplines: DisciplineRow[] = sortDisciplines(
    ((projDisRes.data ?? []) as ProjDisJoin[])
      .map(r => Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines)
      .filter((d): d is DisciplineRow => !!d),
  )

  const subSkills: SubSkillRow[] = ((projSubRes.data ?? []) as ProjSubJoin[])
    .map(r => Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills)
    .filter((s): s is SubSkillRow => !!s)
    .sort((a, b) => a.code.localeCompare(b.code))

  // Per-row metadata lookup maps — used by the inline RowControls.
  const discMeta = new Map<string, { mode: 'detailed' | 'thumbrule'; rate: number | null; notes: string | null; deadline: string | null }>()
  for (const r of (projDisRes.data ?? []) as ProjDisJoin[]) {
    discMeta.set(r.discipline_id, {
      mode: (r.estimation_mode ?? 'detailed') as 'detailed' | 'thumbrule',
      rate: r.thumbrule_rate_per_sft,
      notes: r.thumbrule_notes,
      deadline: r.target_deadline,
    })
  }
  const subMeta = new Map<string, { mode: 'detailed' | 'thumbrule' | null; rate: number | null; notes: string | null; deadline: string | null; completedAt: string | null; completedBy: string | null }>()
  for (const r of (projSubRes.data ?? []) as ProjSubJoin[]) {
    subMeta.set(r.sub_skill_id, {
      mode: r.estimation_mode, // null = inherit
      rate: r.thumbrule_rate_per_sft,
      notes: r.thumbrule_notes,
      deadline: r.target_deadline,
      completedAt: r.completed_at,
      completedBy: r.completed_by,
    })
  }

  // Per-sub-skill / per-category MONEY rollup — the single source of truth
  // shared with the Master Excel export (lib/cost-control/project-rollup.ts),
  // so the spreadsheet always matches this screen. Gives us:
  //   • blMap    — budget / WO / paid by "disc::sub" (and "disc::_root")
  //   • wsAgg    — Internal Estimate (planTotal) + Awaiting (pendingAmount) +
  //                approved + chain count, [IB] baseline never mixed with the
  //                engineer's ask, each chain collapsed to its latest version
  //   • discAgg  — the same rolled up per discipline (root-vs-sub de-duped)
  //   • latestEng — latest engineer sheet per chain (drives the pending list)
  const { blMap, wsAgg, discAgg, latestEng } = computeMoneyRollup({
    wsRows: (wsRes.data ?? []) as RollupWSRow[],
    versionRows: (verRes.data ?? []) as RollupVersionRow[],
    budgetLines: (blRes.data ?? []) as RollupBudgetLine[],
    subSkills: subSkills.map(s => ({ id: s.id, discipline_id: s.discipline_id })),
    disciplines: disciplines.map(d => ({ id: d.id })),
  })

  // Trustee/Admin accept-or-reject decisions on the Internal Estimate, keyed
  // by "discipline::sub_skill". Written by cc_set_internal_estimate onto the
  // 'work' line: set_at + amt ⇒ accepted; set_at + null amt ⇒ rejected.
  type IEDecision = { decision: 'accepted' | 'rejected'; amt: number | null }
  const ieMap = new Map<string, IEDecision>()
  for (const b of (blRes.data ?? []) as BudgetLine[]) {
    if (!b.sub_skill_id || !b.internal_estimate_set_at) continue
    ieMap.set(`${b.discipline_id}::${b.sub_skill_id}`, {
      decision: b.internal_estimate_amt != null ? 'accepted' : 'rejected',
      amt: b.internal_estimate_amt != null ? Number(b.internal_estimate_amt) : null,
    })
  }

  // Short remark per (discipline, sub-skill) — the "Remark: …" line that the
  // Internal Budget import (and any sheet notes) carry. First non-empty wins;
  // shown truncated under the sub-skill name with the full text on hover.
  const remarkAgg = new Map<string, string>()
  for (const w of (wsRes.data ?? []) as WSAgg[]) {
    if (w.status === 'cancelled' || !w.summary_notes) continue
    const k = `${w.discipline_id}::${w.sub_skill_id}`
    if (remarkAgg.has(k)) continue
    const m = w.summary_notes.match(/^Remark:\s*(.+)$/m)
    if (m) remarkAgg.set(k, m[1].trim())
  }

  // Per-(discipline, sub-skill) deadline rollup: earliest open deadline +
  // overdue count for sheets that are still in flight (not approved/paid).
  const TERMINAL = new Set(['approved','wo_issued','paid','cancelled'])
  const dlAgg = new Map<string, { earliest: string | null; overdue: number; openCount: number }>()
  const today = new Date()
  const todayISO = today.toISOString().slice(0, 10)
  for (const w of (wsRes.data ?? []) as WSAgg[]) {
    if (!w.deadline_date) continue
    if (TERMINAL.has(w.status)) continue
    const k = `${w.discipline_id}::${w.sub_skill_id}`
    const cur = dlAgg.get(k) ?? { earliest: null, overdue: 0, openCount: 0 }
    cur.openCount += 1
    if (w.deadline_date < todayISO) cur.overdue += 1
    if (!cur.earliest || w.deadline_date < cur.earliest) cur.earliest = w.deadline_date
    dlAgg.set(k, cur)
  }

  // Engineers
  type ProfileLite = { id: string; full_name: string | null; name: string | null }
  const profileMap = new Map<string, string>()
  for (const p of (profilesRes.data ?? []) as ProfileLite[]) {
    profileMap.set(p.id, p.full_name ?? p.name ?? '(unnamed)')
  }
  type AssignmentRow = { user_id: string; role: string; assigned_disciplines: string[] | null }
  const engineers = ((assignRes.data ?? []) as AssignmentRow[]).map(a => ({
    user_id: a.user_id,
    name: profileMap.get(a.user_id) ?? '(unknown)',
    discipline_ids: a.assigned_disciplines ?? [],
  }))

  type ParentLite = { code: string; name: string } | null
  type PMLite = { full_name: string | null; name: string | null } | null
  const parent: ParentLite = (parentRes.data ?? null) as ParentLite
  const pmRow: PMLite = (pmRes.data ?? null) as PMLite
  const pmName = pmRow?.full_name ?? pmRow?.name ?? null

  // Is this project mapped to a BPH report? Drives the header sync button.
  // Only when the BPH sync feature is switched on in Settings.
  const isBphMapped = ccSettings.bph_sync ? !!(await getBphMappingForProject(id)) : false

  const setupPct = project.setup_progress_pct ?? 0
  const showSetupBanner = setupPct < 100 && project.cc_status === 'setup_incomplete'

  // Sheets in THIS project still awaiting (further) approval — anywhere in
  // the 3-stage chain. Drives one shortcut banner; when thumbrule sheets
  // are among them, the bulk-approve page gets a secondary link.
  // Only the latest version of each engineer chain — same set the money
  // uses — so the shortcut banner's count matches the pending ₹ total.
  const pendingSheets = [...latestEng.values()].map(x => x.w).filter(w =>
    ['submitted', 'ph_approved', 'atm_approved', 'partially_approved'].includes(w.status),
  )
  const pendingCount = pendingSheets.length
  const pendingTotal = Array.from(wsAgg.values()).reduce((s, v) => s + v.pendingAmount, 0)
  const pendingThumbruleCount = pendingSheets.filter(w => w.entry_mode === 'thumbrule').length

  // Click-through for the "Awaiting Approval" figures: which awaiting sheets
  // sit under each sub-skill (and rolled up per discipline). One awaiting sheet
  // → jump straight to it to approve; several → the sub-skill's sheet list.
  const awaitingBySub = new Map<string, string[]>()
  const awaitingByDisc = new Map<string, string[]>()
  for (const w of pendingSheets) {
    if (!w.discipline_id || !w.sub_skill_id) continue
    const sk = `${w.discipline_id}::${w.sub_skill_id}`
    if (!awaitingBySub.has(sk)) awaitingBySub.set(sk, [])
    awaitingBySub.get(sk)!.push(w.id)
    if (!awaitingByDisc.has(w.discipline_id)) awaitingByDisc.set(w.discipline_id, [])
    awaitingByDisc.get(w.discipline_id)!.push(w.id)
  }
  // One awaiting sheet → that sheet (approve it); 2+ → the filtered list; none → not a link.
  const awaitingHref = (ids: string[], listHref: string): string | null =>
    ids.length === 0 ? null : ids.length === 1 ? `/cost-control/working-sheets/${ids[0]}` : listHref

  // The sheet this visit is ABOUT, when the approver arrived from an approval
  // link (?ws=…). Resolved out of this project's own sheets so a stale link —
  // already approved, archived, or pointing at another project — degrades to a
  // quiet "already handled" note instead of a dead button. (#HOD)
  const focusSheet = focusWs
    ? ((wsRes.data ?? []) as WSAgg[]).find(w => w.id === focusWs) ?? null
    : null
  const focusPending = !!focusSheet &&
    ['submitted', 'ph_approved', 'atm_approved', 'partially_approved'].includes(focusSheet.status)
  const focusSubRow  = focusSheet ? subSkills.find(s => s.id === focusSheet.sub_skill_id) ?? null : null
  const focusSheetHref = focusSheet ? `/cost-control/working-sheets/${focusSheet.id}?from=approvals` : null

  // Every sub-skill whose spend/commitment has passed the released ERP budget,
  // worst first — drives the header banner. Built off the same blMap the rows
  // read, so the banner can never name a line the table contradicts. (HOD #4)
  const overBudgetLines = subSkills
    .filter(s => disciplines.some(d => d.id === s.discipline_id))
    .map(s => {
      const d = disciplines.find(x => x.id === s.discipline_id)!
      return {
        label: `${d.code} ${d.name} › ${s.code} ${s.name}`,
        over: overBudgetAmount(blMap.get(`${s.discipline_id}::${s.id}`)),
      }
    })
    .filter(x => x.over > 0)
    .sort((a, b) => b.over - a.over)
  const overBudgetTotal = overBudgetLines.reduce((sum, l) => sum + l.over, 0)

  // Internal Estimate sitting BELOW what ERP already released (HOD #5).
  // Reported, never blocked: 21 lines portfolio-wide already break the rule and
  // estimates are routinely loaded before the ERP figures arrive. What it
  // actually catches is placeholders — a round ₹12,00,000 typed to fill a box.
  // "No estimate at all" is counted apart: a missing baseline is a different
  // problem, and 208 blank lines would bury the 20 genuinely wrong ones.
  const estimateGapLines: { label: string; short: number }[] = []
  let noEstimateCount = 0
  for (const s of subSkills) {
    if (!disciplines.some(d => d.id === s.discipline_id)) continue
    const d = disciplines.find(x => x.id === s.discipline_id)!
    const bl = blMap.get(`${s.discipline_id}::${s.id}`)
    const est = wsAgg.get(`${s.discipline_id}::${s.id}`)?.planTotal ?? 0
    if (hasNoEstimate(est, bl)) { noEstimateCount++; continue }
    const short = estimateShortfall(est, bl)
    if (short > 0) estimateGapLines.push({ label: `${d.code} ${d.name} › ${s.code} ${s.name}`, short })
  }
  estimateGapLines.sort((a, b) => b.short - a.short)
  const estimateGapTotal = estimateGapLines.reduce((sum, l) => sum + l.short, 0)

  // Adhoc vs BOQ per sub-category (HOD #7). A sub-category can hold several
  // sheets, so it is only "Adhoc" if a sheet under it was DECLARED adhoc, and
  // only "BOQ" once every declared sheet says BOQ. Undeclared sheets are
  // counted, never guessed at — that is the state the HOD anticipated when he
  // said "if Mayank bhai forgets".
  const adhocBySub = new Map<string, { adhoc: number; boq: number; undeclared: number }>()
  for (const w of (wsRes.data ?? []) as WSAgg[]) {
    if (w.status === 'cancelled') continue
    if ((w.summary_notes ?? '').startsWith('[IB')) continue // the baseline is not a budget request
    const k = `${w.discipline_id}::${w.sub_skill_id}`
    const cur = adhocBySub.get(k) ?? { adhoc: 0, boq: 0, undeclared: 0 }
    if (w.is_adhoc === true) cur.adhoc++
    else if (w.is_adhoc === false) cur.boq++
    else cur.undeclared++
    adhocBySub.set(k, cur)
  }
  const undeclaredCount = Array.from(adhocBySub.values()).reduce((n, v) => n + v.undeclared, 0)
  const adhocCount = Array.from(adhocBySub.values()).reduce((n, v) => n + v.adhoc, 0)

  // Item-wise BOQ under each sub-category (HOD #8a). The rows the approver
  // checks, shown in the tree instead of only on the sheet. Loaded for the
  // LATEST version of each budget chain — the biggest project in the system is
  // 130 rows, so there is nothing to gain from lazy-loading and a lot to lose
  // in complexity.
  const boqBySub = new Map<string, BoqSheet[]>()
  {
    const latestIds = [...latestEng.values()].map(x => x.w.id)
    if (latestIds.length > 0) {
      const { data: boqRows } = await supabase
        .from('cc_excel_rows')
        .select('id, working_sheet_id, row_no, description, unit, qty, rate, amount, formula_in_amount, rate_breakdown, flag_severity, flag_reason, source_sheet, source_cell, qty_formula, qty_basis')
        .in('working_sheet_id', latestIds)
        .order('row_no', { ascending: true })
      const byWs = new Map<string, BoqRow[]>()
      for (const r of (boqRows ?? []) as Record<string, unknown>[]) {
        const wsId = r.working_sheet_id as string
        const bag = byWs.get(wsId) ?? []
        bag.push({
          id: r.id as string,
          rowNo: r.row_no as number | null,
          description: r.description as string | null,
          unit: r.unit as string | null,
          qty: r.qty == null ? null : Number(r.qty),
          rate: r.rate == null ? null : Number(r.rate),
          amount: r.amount == null ? null : Number(r.amount),
          sourceSheet: r.source_sheet as string | null,
          sourceCell: r.source_cell as string | null,
          qtyFormula: r.qty_formula as string | null,
          qtyBasis: r.qty_basis as string | null,
          formulaInAmount: r.formula_in_amount as string | null,
          rateBreakdown: (r.rate_breakdown as { label: string; value: number }[] | null) ?? null,
          flagSeverity: r.flag_severity as string | null,
          flagReason: r.flag_reason as string | null,
        })
        byWs.set(wsId, bag)
      }
      for (const { w } of latestEng.values()) {
        const rows = byWs.get(w.id) ?? []
        if (rows.length === 0) continue
        const key = `${w.discipline_id}::${w.sub_skill_id}`
        const bag = boqBySub.get(key) ?? []
        bag.push({
          wsId: w.id,
          wsCode: (w as { ws_code?: string | null }).ws_code ?? null,
          statusLabel: wsStatusLabel(w.status),
          total: rows.reduce((n, r) => n + (r.amount ?? 0), 0),
          rows,
        })
        boqBySub.set(key, bag)
      }
    }
  }

  // Master items NOT yet on this project, for the "Add …" pickers. Only read
  // for someone who can actually add — no point paying for it otherwise.
  // Small lists (36 categories / 233 sub-categories portfolio-wide), so one
  // round trip rather than a search box. (HOD #6)
  let addableDisciplines: { id: string; code: string; name: string }[] = []
  const addableSubsByDiscipline = new Map<string, { id: string; code: string; name: string }[]>()
  if (canAddStructure) {
    const [allDiscRes, allSubRes] = await Promise.all([
      supabase.from('cc_disciplines').select('id, code, name, is_archived'),
      supabase.from('cc_sub_skills').select('id, discipline_id, code, name'),
    ])
    const onProject = new Set(disciplines.map(d => d.id))
    addableDisciplines = ((allDiscRes.data ?? []) as { id: string; code: string; name: string; is_archived: boolean | null }[])
      .filter(d => !d.is_archived && !onProject.has(d.id))
      .map(d => ({ id: d.id, code: d.code, name: d.name }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    const enabledSubs = new Set(subSkills.map(s => s.id))
    for (const s of (allSubRes.data ?? []) as { id: string; discipline_id: string; code: string; name: string }[]) {
      if (enabledSubs.has(s.id)) continue
      const bag = addableSubsByDiscipline.get(s.discipline_id) ?? []
      bag.push({ id: s.id, code: s.code, name: s.name })
      addableSubsByDiscipline.set(s.discipline_id, bag)
    }
    for (const bag of addableSubsByDiscipline.values()) {
      bag.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    }
  }

  // Closed sub-categories (HOD #3) and the budget they released. Two figures
  // worth separating: what has already been released, and what is sitting
  // ready to be released the moment someone presses the button.
  const completedCount = subSkills.filter(s => subMeta.get(s.id)?.completedAt).length
  const releasedTotal = subSkills.reduce((sum, s) => {
    if (!subMeta.get(s.id)?.completedAt) return sum
    return sum + savingsOnCompletion(blMap.get(`${s.discipline_id}::${s.id}`))
  }, 0)
  const readyToClose = subSkills.filter(s =>
    !subMeta.get(s.id)?.completedAt && canMarkComplete(blMap.get(`${s.discipline_id}::${s.id}`)),
  )
  const readyToCloseSavings = readyToClose.reduce(
    (sum, s) => sum + savingsOnCompletion(blMap.get(`${s.discipline_id}::${s.id}`)), 0)


  // Portfolio rollup (across all sub-skills on this project)
  const totalBudget = Array.from(discAgg.values()).reduce((s, v) => s + v.budget, 0)
  const totalWO = Array.from(discAgg.values()).reduce((s, v) => s + v.wo, 0)
  const totalPaid = Array.from(discAgg.values()).reduce((s, v) => s + v.paid, 0)
  const totalApproved = Array.from(discAgg.values()).reduce((s, v) => s + v.approvedTotal, 0)
  const totalEstimate = Array.from(discAgg.values()).reduce((s, v) => s + v.estimate, 0)
  const utilPct = totalBudget > 0 ? Math.round((totalPaid / totalBudget) * 100) : 0
  const releasedPct = totalEstimate > 0 ? Math.round((totalBudget / totalEstimate) * 100) : 0
  // Released money Billing has already keyed into IN4 — it shows here
  // until the next BPH pull brings the ERP numbers in line.
  const enteredAwaitingPull = ((wsRes.data ?? []) as WSAgg[])
    .filter(w => w.in4_entered_at && (w.status === 'approved' || w.status === 'partially_approved'))
    .reduce((s, w) => s + Number(w.approved_for_erp_amt ?? 0), 0)

  // ₹/sft companion for every money figure (Trustee requirement). Uses the
  // project's built-up area; hidden gracefully when no area is set, and
  // switchable off from Cost Control settings.
  const sft = Number(project.built_up_sft ?? 0)
  const perSft = (amt: number): string | null => {
    if (!(ccSettings.show_per_sft && sft > 0 && amt > 0)) return null
    const rate = Math.round(amt / sft)
    // "₹0/sft" is noise, not information: on SRAH's 8,40,034 sft anything under
    // ~₹4.2 L rounds to zero, so small lines were printing a rate that told the
    // reader nothing. Show the figure alone instead.
    if (rate <= 0) return null
    return `₹${rate.toLocaleString('en-IN')}/sft`
  }
  /** Inline " · ₹N/sft" for prose and banners, where a stacked sub-line
   *  would not fit. Empty string when there is no meaningful rate. */
  const perSftInline = (amt: number): string => {
    const r = perSft(amt)
    return r ? ` · ${r}` : ''
  }

  // The pending sheets themselves, for the alert strip: he asked to open them
  // from there rather than be sent to a list page to find the same row again.
  // Biggest ask first — that is the one worth his attention. Capped so the
  // strip can never become the page; "See all" covers the rest.
  const ALERT_SHEETS_MAX = 8
  const pendingSheetItems = [...pendingSheets]
    .sort((a, b) => Number(b.total_amount ?? 0) - Number(a.total_amount ?? 0))
    .slice(0, ALERT_SHEETS_MAX)
    .map(w => {
      const d = disciplines.find(x => x.id === w.discipline_id)
      const s = subSkills.find(x => x.id === w.sub_skill_id)
      const amt = Number(w.total_amount ?? 0)
      // IST calendar days, not elapsed ms — "waiting 3d" must mean three dates.
      const age = w.submitted_at ? istCalendarDaysAgo(w.submitted_at) : null
      return {
        id: w.id,
        label: [d ? `${d.code} ${d.name}` : null, s ? `${s.code} ${s.name}` : null]
          .filter(Boolean).join(' › ') || 'Budget',
        amountLabel: `${formatINR(amt)}${perSftInline(amt)}`,
        stageLabel: wsStatusLabel(w.status),
        ageDays: age,
        // Same rule as every other approval link: open the sub-category in
        // context first — this page again, that row ambered and scrolled to —
        // and step into the voucher from there. Straight to the sheet would
        // skip exactly the context the HOD asked for.
        href: ccApprovalPath({
          projectId: project.id,
          disciplineId: w.discipline_id,
          subSkillId: w.sub_skill_id,
          wsId: w.id,
        }),
      }
    })
  // Visible column count for empty-state rows (name + Internal Estimate +
  // Awaiting Approval + Released via WS + Working Sheets + actions, plus the
  // toggleable ERP and deadline groups).
  const tableCols = 6 + (showErp ? 4 : 0) + (ccSettings.show_deadlines ? 2 : 0)

  const Money = ({ amt, dash = '—' }: { amt: number; dash?: string }) => {
    if (!(amt > 0)) return <>{dash}</>
    const rate = perSft(amt)
    return (
      <>
        {formatINR(amt)}
        {rate && <span className="block text-[10px] font-normal text-gray-400 leading-tight">{rate}</span>}
      </>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs">
        <Link href="/cost-control" className="text-blue-600 hover:underline">← {ccLabel}</Link>
        {parent && (
          <>
            <span className="text-gray-300">/</span>
            <span className="text-gray-500">{parent.name} ({parent.code})</span>
          </>
        )}
      </div>

      {/* Title + primary actions. All project configuration (rename, alias,
          area, grouping/parent, BPH mapping, approvers, engineer assignment)
          lives on the Settings screen behind the gear — this page stays on
          the numbers + working sheets. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageHeader
            title={project.name}
            subtitle={[
              project.code,
              pmName ? `Owner: ${pmName}` : null,
              project.start_date ? `Started ${new Date(project.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}` : null,
            ].filter(Boolean).join(' · ')}
            className="mb-0"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {project.cc_status && (
            <span className={`inline-flex items-center px-2 py-1 rounded-full text-[10px] font-bold tracking-wide ${
              project.cc_status === 'active' ? 'bg-green-100 text-green-800' :
              project.cc_status === 'on_hold' ? 'bg-amber-100 text-amber-800' :
              project.cc_status === 'completed' ? 'bg-blue-100 text-blue-800' :
              'bg-gray-100 text-gray-700'
            }`}>{wsStatusLabel(project.cc_status).toUpperCase()}</span>
          )}
          {canWrite && (
            <>
              <Link
                href={`/cost-control/working-sheets/new-quick?project=${project.id}`}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" /> Raise Budget Request
              </Link>
              {ccSettings.bph_sync && <BphSyncButton projectId={project.id} isMapped={isBphMapped} />}
              {/* Icon-only on a phone. Four labelled buttons wrapped onto three
                  lines and pushed the whole table down the screen; these two are
                  occasional, so the label is the part that gives way. */}
              <Link
                href={`/cost-control/projects/${project.id}/setup`}
                className="inline-flex items-center justify-center gap-1.5 h-9 min-w-[44px] px-2.5 sm:px-3 rounded-md bg-white text-gray-700 border border-gray-300 text-sm font-semibold hover:bg-gray-50"
                title="Project settings — details, grouping/parent, BPH mapping, approvers, engineers & disciplines"
                aria-label="Project settings"
              >
                <Settings className="h-4 w-4" /> <span className="hidden sm:inline">Settings</span>
              </Link>
            </>
          )}
          {reviewer && (
            <a
              href={`/api/cost-control/master-export?project=${project.id}`}
              className="inline-flex items-center justify-center gap-1.5 h-9 min-w-[44px] px-2.5 sm:px-3 rounded-md bg-white text-emerald-800 border border-emerald-300 text-sm font-semibold hover:bg-emerald-50"
              title="Download the whole Internal Estimate as one linked Master Excel — every category & sub-skill, sheets cross-linked"
              aria-label="Download Master Excel"
            >
              <Download className="h-4 w-4" /> <span className="hidden sm:inline">Master Excel</span>
            </a>
          )}
        </div>
      </div>

      {/* Internal Estimate lock + revision workflow (management only). One
          slim status bar; actions (request to revise / Trustee decision)
          appear inline right when they're relevant. */}
      {reviewer && (
        <IeRevisionPanel
          projectId={project.id}
          lockState={lockState}
          revision={ieRevision}
          canRequest={canRequestRevision}
          canDecide={canDecideRevision}
        />
      )}

      {/* Deliberately NO "waiting on you" banner for a live approval. The
          row itself is ambered, scrolled to, and carries its own Approve
          button, so a bar at the top only pushed the table further down the
          phone — Aksha, looking at it: "i dont want here".

          A STALE link still gets one quiet line, because landing on a row
          with nothing to approve and no explanation is a dead end. */}
      {focusSheet && focusSheetHref && !focusPending && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5">
          <p className="text-[12.5px] text-gray-700">
            <b>Already handled.</b>{' '}
            {focusSubRow ? `${focusSubRow.code} ${focusSubRow.name}` : 'This sub-category'}
            {' '}is {wsStatusLabel(focusSheet.status).toLowerCase()} — nothing is waiting on you here.
          </p>
          <Link href={focusSheetHref} className="mt-1.5 inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-md border border-gray-300 bg-white text-[12px] font-semibold text-gray-700">
            Open the sheet <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* One strip for everything that needs a look, instead of three
          stacked full-width banners. Counts always visible; the prose opens
          on tap. Four alert cards above the table meant scrolling past a
          wall of boxes on a phone before reaching a single number. */}
      <ProjectAlerts
        pending={pendingCount > 0 && canWrite ? {
          count: pendingCount,
          amountLabel: pendingTotal > 0 ? `${formatINR(pendingTotal)}${perSftInline(pendingTotal)}` : null,
          href: `/cost-control/working-sheets?project=${project.id}`,
          thumbruleCount: pendingThumbruleCount,
          thumbruleHref: `/cost-control/approvals/thumbrule?project=${project.id}`,
          sheets: pendingSheetItems,
        } : null}
        over={showErp && overBudgetLines.length > 0 ? {
          lines: overBudgetLines.map(l => ({ label: l.label, amountLabel: formatINR(l.over) })),
          totalLabel: `${formatINR(overBudgetTotal)}${perSftInline(overBudgetTotal)}`,
        } : null}
        estimateGap={showErp && (estimateGapLines.length > 0 || noEstimateCount > 0) ? {
          lines: estimateGapLines.map(l => ({ label: l.label, amountLabel: formatINR(l.short) })),
          totalLabel: `${formatINR(estimateGapTotal)}${perSftInline(estimateGapTotal)}`,
          noEstimateCount,
        } : null}
        adhoc={{ undeclaredCount, adhocCount }}
        completion={showErp ? {
          completedCount,
          releasedLabel: releasedTotal > 0 ? `${formatINR(releasedTotal)}${perSftInline(releasedTotal)}` : null,
          readyCount: readyToClose.length,
          readySavingsLabel: readyToCloseSavings > 0 ? `${formatINR(readyToCloseSavings)}${perSftInline(readyToCloseSavings)}` : null,
        } : null}
      />

      {/* Gap between what HOD has approved in CT Hub and what IN4 has
          released. Positive gap = work to do in IN4 + then re-pull BPH. */}
      {(() => {
        if (!showErp) return null
        const gap = totalApproved - totalBudget
        if (gap <= 0 || totalApproved === 0) return null
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
            <Info className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              <b>{formatINR(gap)}</b> approved here but not yet reflected from IN4
              {enteredAwaitingPull > 0 && <> — of which <b>{formatINR(enteredAwaitingPull)}</b> is already entered in IN4 by Billing, awaiting your next BPH pull</>}. Push the rest through IN4, then the next BPH upload brings this in line.
            </span>
          </div>
        )
      })()}

      {/* KPI strip — portfolio-level numbers for this project. The ERP
          tiles (from Budget vs Actual) hide when the toggle is off. */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${showErp ? 'lg:grid-cols-5' : ''} gap-3`}>
        <KPI
          label="Internal Estimate"
          value={totalEstimate > 0 ? formatINR(totalEstimate) : '—'}
          perSft={perSft(totalEstimate)}
          sub={totalEstimate > 0 ? 'Imported baseline (latest per item)' : 'Will populate once WSes are raised'}
          tone="indigo"
        />
        <KPI
          label="Awaiting Approval"
          value={pendingTotal > 0 ? formatINR(pendingTotal) : '—'}
          perSft={perSft(pendingTotal)}
          sub={pendingCount > 0
            ? `${pendingCount} sheet${pendingCount === 1 ? '' : 's'} in the approval chain`
            : 'Nothing pending'}
          tone="amber"
        />
        {showErp && (
          <KPI
            label="Approved Budget (ERP)"
            value={formatINR(totalBudget)}
            perSft={perSft(totalBudget)}
            sub={
              totalBudget > 0
                ? (totalEstimate > 0
                    ? `${releasedPct}% of estimate released`
                    : `${disciplines.length} disciplines`)
                : (
                    <span className="text-[11px] text-gray-500">
                      Fills when Heads approve releases.
                      {ccSettings.bph_sync && (
                        <>
                          {' '}
                          <Link
                            href={`/cost-control/import/bph?cc_project=${project.id}`}
                            className="text-teal-700 hover:underline font-medium"
                          >
                            Or pull from your BPH report →
                          </Link>
                        </>
                      )}
                    </span>
                  )
            }
            tone="blue"
          />
        )}
        {showErp && (
          <KPI label="Committed (WO/PO)" value={formatINR(totalWO)} perSft={perSft(totalWO)}
               sub={totalBudget > 0 ? `${Math.round((totalWO / totalBudget) * 100)}% of budget` : '—'} tone="purple" />
        )}
        {showErp && (
          <KPI label="Paid to Date" value={formatINR(totalPaid)} perSft={perSft(totalPaid)}
               sub={totalBudget > 0 ? `${utilPct}% utilized` : '—'} tone="orange" />
        )}
      </div>

      {showSetupBanner && (
        <SetupProgressBanner projectId={project.id} progressPct={setupPct} />
      )}

      {/* THE TABLE — discipline categories + sub-skill rows. ERP columns
          (Budget vs Actual) and deadline columns follow the settings toggles.
          Categories collapse into their cumulative totals (project-tree). */}
      <TreeProvider
        // Remount when the focused row changes. TreeProvider seeds `collapsed`
        // from a useState INITIALISER, which runs only on mount — and tapping a
        // row in the alert strip is a same-route navigation (only the search
        // params change), so React keeps the old instance and the new
        // initialCollapsedIds are ignored. Every category stayed collapsed, the
        // target row was never rendered, and FocusScroll had nothing to scroll
        // to: the tap looked like it did nothing. A key is the idiomatic reset.
        key={`${focusDisc ?? ''}|${focusSub ?? ''}`}
        allCatIds={disciplines.map(d => d.id)}
        // Declutter by default: management lands on rolled-up categories (expand
        // what you need). A deep-link from an approval opens ONLY its category.
        initialCollapsedIds={
          focusDisc
            ? disciplines.filter(d => d.id !== focusDisc).map(d => d.id)
            : disciplines.map(d => d.id)
        }
        // In focus mode show every sub-skill in the opened category so the
        // targeted one is guaranteed visible (even if it has no activity yet).
        initialHideEmpty={!focusSub}
        emptyCount={subSkills.filter(s => {
          if (!disciplines.some(d => d.id === s.discipline_id)) return false
          const bl = blMap.get(`${s.discipline_id}::${s.id}`)
          const a = wsAgg.get(`${s.discipline_id}::${s.id}`)
          return (a?.planTotal ?? 0) === 0 && (a?.pendingAmount ?? 0) === 0 && (a?.chains.size ?? 0) === 0
            && (bl?.budget ?? 0) === 0 && (bl?.wo ?? 0) === 0 && (bl?.paid ?? 0) === 0
        }).length}
      >
      {/* The same sub-skill exists twice — desktop row and phone card — so hand
          both ids over and let it scroll to whichever is actually on screen. */}
      <RowDetailProvider>
      {focusSub && <FocusScroll targetIds={[`sub-${focusSub}`, `subm-${focusSub}`]} />}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60">
          {/* On a phone the sentence stole the whole row and forced the toolbar
              buttons to wrap onto two lines each. */}
          <span className="text-[11px] font-medium text-gray-500">
            Work categories<span className="hidden sm:inline"> — click a row to collapse; totals roll up.</span>
          </span>
          <TreeToolbar />
        </div>
        {/* The header row stays visible while you read down the table. Sticky
            needs a scrollport that actually scrolls, so the table body scrolls
            INSIDE this box (max-h) rather than with the page: `main` in
            app/(app)/layout.tsx sets overflow-x-auto, which forces overflow-y
            to auto and makes it the nearest scrollport — one that never scrolls
            itself — so a page-scroll sticky header just scrolls away. Pinning
            to the viewport instead would mean dropping the horizontal scroll
            this wide table needs, since overflow-x:auto cannot pair with
            overflow-y:visible. max-h (not h) means a short table still renders
            at its natural height with no scrollbar and no dead space. */}
        <div className="overflow-auto max-h-[75vh] hidden md:block">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-left">
              <tr>
                <Th className="min-w-[280px]">Work Category / Sub-skill</Th>
                <Th align="right" className="w-32">Internal Estimate</Th>
                <Th align="right" className="w-32">Awaiting Approval</Th>
                {/* "Released via WS" named the mechanism, not the meaning. This
                    is money approved through CT Hub's own approval chain — the
                    counterpart to "Budget (ERP)", which is what IN4 says. */}
                <Th align="right" className="w-32">Budget Approved in CT Hub</Th>
                {showErp && (
                  <>
                    <Th align="right">Budget (ERP)</Th>
                    <Th align="right">WO / PO</Th>
                    <Th align="right">Paid</Th>
                    <Th align="right" className="w-20">% Used</Th>
                  </>
                )}
                <Th className="w-28">Working Sheets</Th>
                {ccSettings.show_deadlines && (
                  <>
                    <Th className="w-44">Plan Deadline</Th>
                    <Th className="w-28">WS Status</Th>
                  </>
                )}
                <Th className="w-28"></Th>
              </tr>
            </thead>
            <tbody>
              {disciplines.length === 0 && (
                <tr><td colSpan={tableCols} className="px-4 py-8 text-center text-sm text-gray-500">No disciplines enabled. Open the setup wizard to pick them.</td></tr>
              )}

              {disciplines.map(d => {
                const dAgg = discAgg.get(d.id) ?? { budget: 0, wo: 0, paid: 0, approvedTotal: 0, estimate: 0, pending: 0 }
                const dPct = dAgg.budget > 0 ? (dAgg.paid / dAgg.budget) * 100 : 0
                const subs = subSkills.filter(s => s.discipline_id === d.id)
                const dHot = dPct > 95
                const dOver = overBudgetAmount(dAgg)

                // Discipline-level earliest open deadline across its sub-skills
                let dEarliest: string | null = null
                let dOverdue = 0
                let dWsCount = 0
                for (const s of subs) {
                  const dl = dlAgg.get(`${d.id}::${s.id}`)
                  if (dl) {
                    dOverdue += dl.overdue
                    if (dl.earliest && (!dEarliest || dl.earliest < dEarliest)) dEarliest = dl.earliest
                  }
                  const sAgg = wsAgg.get(`${d.id}::${s.id}`)
                  if (sAgg) dWsCount += sAgg.chains.size
                }

                return (
                  <>
                    <tr key={d.id} className="border-t border-gray-200 bg-slate-50 font-semibold">
                      <td className="px-3 py-2.5">
                        <CatChevron catId={d.id} />
                        <span className="font-mono text-[11px] text-gray-500 mr-2">{d.code}</span>
                        <span className="text-gray-900">{d.name}</span>
                        {dHot && <Flame className="inline h-3.5 w-3.5 text-orange-500 ml-2" />}
                      </td>
                      <Td align="right" mono className="text-indigo-800">
                        <Money amt={dAgg.estimate} />
                      </Td>
                      <Td align="right" mono className="text-amber-700">
                        {(() => {
                          const href = awaitingHref(awaitingByDisc.get(d.id) ?? [], `/cost-control/working-sheets?project=${project.id}&discipline=${d.id}`)
                          return href
                            ? <Link href={href} className="inline-block rounded px-1 -mx-1 hover:bg-amber-50 hover:underline decoration-amber-400 underline-offset-2" title="Open the sheet(s) awaiting approval"><Money amt={dAgg.pending} /></Link>
                            : <Money amt={dAgg.pending} />
                        })()}
                      </Td>
                      <Td align="right" mono className="text-emerald-700">
                        <Money amt={dAgg.approvedTotal} />
                      </Td>
                      {showErp && (
                        <>
                          <Td align="right" mono><Money amt={dAgg.budget} /></Td>
                          <Td align="right" mono className="text-gray-600"><Money amt={dAgg.wo} /></Td>
                          <Td align="right" mono className="text-gray-600"><Money amt={dAgg.paid} /></Td>
                          <Td align="right" className={dOver > 0 ? 'text-rose-700 font-bold' : dPct > 95 ? 'text-red-600' : dPct > 80 ? 'text-amber-700' : 'text-green-700'}>
                            {dAgg.budget > 0 ? `${dPct.toFixed(0)}%` : '—'}
                            {/* NET for the whole category — individual lines can
                                be further over while others still have headroom,
                                so this figure is deliberately smaller than the
                                sum in the header banner. Spelled out, because
                                two true numbers that differ look like a bug. */}
                            {dOver > 0 && (
                              <span
                                className="block text-[10px] font-extrabold leading-tight text-rose-600"
                                title={`This whole category is ${formatINR(dOver)} over its released budget, after netting off the sub-categories that still have budget left. Expand it to see which lines are over.`}
                              >
                                OVER {formatINR(dOver)} net
                              </span>
                            )}
                          </Td>
                        </>
                      )}
                      <Td>
                        {dWsCount > 0
                          ? <span className="text-[11px] text-gray-500">{dWsCount} sheet{dWsCount === 1 ? '' : 's'}</span>
                          : <span className="text-[11px] text-gray-400">—</span>}
                      </Td>
                      {ccSettings.show_deadlines && (
                        <>
                          <Td>
                            <DeadlineCell
                              projectId={project.id}
                              disciplineId={d.id}
                              initialDeadline={discMeta.get(d.id)?.deadline ?? null}
                              inheritedFromWS={dEarliest}
                              canWrite={canWrite}
                            />
                          </Td>
                          <Td>
                            {dEarliest ? (
                              <div className="inline-flex items-center gap-1">
                                <DeadlineBadge deadlineDate={dEarliest} compact />
                                {dOverdue > 0 && <span className="text-[10px] font-bold text-rose-700 bg-rose-100 rounded-full px-1.5">+{dOverdue}</span>}
                              </div>
                            ) : (
                              <span className="text-[11px] text-gray-400">—</span>
                            )}
                          </Td>
                        </>
                      )}
                      <Td>
                        <DisableButton
                          projectId={project.id}
                          disciplineId={d.id}
                          label={`${d.code} ${d.name}`}
                          attachedCount={dWsCount}
                          canWrite={canWrite}
                        />
                      </Td>
                    </tr>

                    <CatRows catId={d.id}>
                    {subs.map(s => {
                      const bl = blMap.get(`${d.id}::${s.id}`)
                      const a = wsAgg.get(`${d.id}::${s.id}`)
                      const sPct = bl && bl.budget > 0
                        ? (bl.paid / bl.budget) * 100
                        : 0
                      const sHot = sPct > 95
                      // Spent/committed past what ERP released — a different
                      // fact from "nearly full". (HOD #4)
                      const sOver = overBudgetAmount(bl)
                      const sOverBy = overBudgetDriver(bl)
                      const sCompletedAt = subMeta.get(s.id)?.completedAt ?? null
                      const sCompletedBy = profileMap.get(subMeta.get(s.id)?.completedBy ?? '') ?? null
                      const wsCount = a?.chains.size ?? 0
                      const ie = ieMap.get(`${d.id}::${s.id}`)
                      const estLive = a?.planTotal ?? 0
                      const ask = a?.pendingAmount ?? 0
                      const released = a?.approvedTotal ?? 0
                      // Estimate below what ERP already released (HOD #5).
                      const sEstShort = estimateShortfall(estLive, bl)
                      const sNoEstimate = hasNoEstimate(estLive, bl)
                      // estLive is now the Internal Estimate baseline alone
                      // (the latest [IB] upload) — no longer mixed with the
                      // engineer's ask — so compare the ask straight against
                      // it. A Trustee-accepted amount still wins.
                      const baseline = estLive
                      const overBy = baseline > 0 && ask > baseline ? ask - baseline : 0
                      // Effective estimation mode, computed once and reused in
                      // the name cell (read-only signal) + the ▾ config menu
                      // (the editable controls) + the New WS route.
                      const effMode = subMeta.get(s.id)?.mode ?? discMeta.get(d.id)?.mode ?? 'detailed'
                      // "Empty" = nothing to show at all (no estimate, no ask,
                      // no sheet, no ERP). Hidden by default via the ▾ Hide-empty
                      // toggle so the table isn't a wall of "—".
                      const isEmpty = estLive === 0 && ask === 0 && wsCount === 0
                        && (bl?.budget ?? 0) === 0 && (bl?.wo ?? 0) === 0 && (bl?.paid ?? 0) === 0
                      const isFocus = focusSub === s.id
                      return (
                        <SubRow key={s.id} empty={isEmpty}>
                        <tr id={`sub-${s.id}`} className={`border-t border-gray-100 hover:bg-gray-50/60 ${isFocus ? 'bg-amber-100/70 ring-2 ring-inset ring-amber-400' : ''}`}>
                          <td className="pl-10 pr-3 py-2 text-gray-700">
                            <span className="font-mono text-[11px] text-gray-400 mr-2">{s.code}</span>
                            <span>{s.name}</span>
                            <RowDetailToggle id={s.id} count={(boqBySub.get(`${d.id}::${s.id}`) ?? []).reduce((n, b) => n + b.rows.length, 0)} />
                            {sHot && <Flame className="inline h-3 w-3 text-orange-500 ml-1.5" />}
                            {/* Thumbrule is the rare exception — flag it read-only.
                                BOQ (the default) shows no chip. The mode TOGGLE now
                                lives in the ▾ config menu, not on the row. */}
                            {(() => {
                              const t = adhocBySub.get(`${d.id}::${s.id}`)
                              if (!t || (t.adhoc === 0 && t.boq === 0)) return null
                              const isAdhoc = t.adhoc > 0
                              return (
                                <span
                                  title={isAdhoc ? 'A budget here was declared adhoc — extra work outside the BOQ' : 'Every declared budget here is as per the BOQ estimate'}
                                  className={`ml-1.5 align-middle inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-extrabold border ${isAdhoc ? 'bg-orange-50 text-orange-800 border-orange-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                                >
                                  {isAdhoc ? 'ADHOC' : 'BOQ'}
                                </span>
                              )
                            })()}
                            {effMode === 'thumbrule' && (
                              <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] font-semibold rounded px-1.5 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 align-middle" title="Thumbrule (rate × area)">
                                <Ruler className="h-2.5 w-2.5" /> TR
                              </span>
                            )}
                            {(() => {
                              const remark = remarkAgg.get(`${d.id}::${s.id}`)
                              if (!remark) return null
                              return (
                                <p
                                  className="text-[11px] italic text-gray-400 truncate max-w-[260px] leading-snug"
                                  title={remark}
                                >
                                  {remark.length > 70 ? remark.slice(0, 70) + '…' : remark}
                                </p>
                              )
                            })()}
                          </td>
                          <Td align="right" mono className="text-indigo-800">
                            <Money amt={estLive} />
                            {/* Below what ERP already released — usually a
                                placeholder nobody filled in. (HOD #5) */}
                            {sEstShort > 0 && (
                              <span
                                className="block text-[10px] font-extrabold leading-tight text-violet-700"
                                title={`The Internal Estimate is ${formatINR(sEstShort)} lower than the budget already approved in ERP. An estimate can only be higher than what ERP has released, never lower.`}
                              >
                                ▼ {formatINR(sEstShort)} below ERP
                              </span>
                            )}
                            {sNoEstimate && (
                              <span
                                className="block text-[10px] font-bold leading-tight text-violet-700"
                                title={`ERP has released ${formatINR(bl?.budget ?? 0)} against this sub-category but no Internal Estimate was ever set.`}
                              >
                                no estimate set
                              </span>
                            )}
                            {ccSettings.ie_review && (estLive > 0 || ie) && (
                              <div className="mt-1 flex justify-end">
                                <InternalEstimateDecision
                                  projectId={project.id}
                                  disciplineId={d.id}
                                  subSkillId={s.id}
                                  liveAmount={estLive}
                                  decision={ie?.decision ?? null}
                                  acceptedAmt={ie?.amt ?? null}
                                  canDecide={canDecideIE}
                                />
                              </div>
                            )}
                          </Td>
                          <Td align="right" mono className={overBy > 0 ? 'text-rose-700 font-semibold' : 'text-amber-700'}>
                            {(() => {
                              const ids = awaitingBySub.get(`${d.id}::${s.id}`) ?? []
                              const href = awaitingHref(ids, `/cost-control/working-sheets?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`)
                              const body = (
                                <>
                                  <Money amt={ask} />
                                  {overBy > 0 && (
                                    <span className="block text-[10px] font-bold text-rose-600 leading-tight"
                                      title={`Engineer is asking ${formatINR(overBy)} above the Internal Estimate`}>
                                      ▲ over by {formatINR(overBy)}
                                    </span>
                                  )}
                                </>
                              )
                              return href
                                ? <Link href={href} className="inline-block rounded px-1 -mx-1 hover:bg-amber-50 hover:underline decoration-amber-400 underline-offset-2"
                                    title={ids.length === 1 ? 'Open this sheet to approve' : `${ids.length} sheets awaiting — open the sub-skill’s list`}>{body}</Link>
                                : body
                            })()}
                          </Td>
                          <Td align="right" mono className="text-emerald-700">
                            <Money amt={released} />
                          </Td>
                          {showErp && (
                            <>
                              <Td align="right" mono><Money amt={bl?.budget ?? 0} /></Td>
                              <Td align="right" mono className="text-gray-600"><Money amt={bl?.wo ?? 0} /></Td>
                              <Td align="right" mono className="text-gray-600"><Money amt={bl?.paid ?? 0} /></Td>
                              <Td align="right" className={sOver > 0 ? 'text-rose-700 font-bold' : sPct > 95 ? 'text-red-600 font-semibold' : sPct > 80 ? 'text-amber-700 font-semibold' : sPct > 0 ? 'text-green-700 font-semibold' : 'text-gray-400'}>
                                {bl && bl.budget > 0 ? `${sPct.toFixed(0)}%` : '—'}
                                {sOver > 0 && (
                                  <span
                                    className="block text-[10px] font-extrabold leading-tight text-rose-600"
                                    title={`${sOverBy === 'paid' ? 'Paid' : 'Committed on WO/PO'} is ${formatINR(sOver)} more than the budget released in ERP`}
                                  >
                                    OVER {formatINR(sOver)}
                                  </span>
                                )}
                              </Td>
                            </>
                          )}
                          <Td>
                            {wsCount > 0 ? (
                              <Link
                                href={`/cost-control/working-sheets?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
                              >
                                {wsCount} sheet{wsCount === 1 ? '' : 's'}
                              </Link>
                            ) : (
                              <span className="text-[11px] text-gray-400">—</span>
                            )}
                          </Td>
                          {ccSettings.show_deadlines && (
                            <>
                              <Td>
                                <DeadlineCell
                                  projectId={project.id}
                                  subSkillId={s.id}
                                  initialDeadline={subMeta.get(s.id)?.deadline ?? null}
                                  inheritedFromDiscipline={discMeta.get(d.id)?.deadline ?? null}
                                  inheritedFromWS={dlAgg.get(`${d.id}::${s.id}`)?.earliest ?? null}
                                  canWrite={canWrite}
                                />
                              </Td>
                              <Td>
                                {(() => {
                                  const dl = dlAgg.get(`${d.id}::${s.id}`)
                                  if (!dl?.earliest) return <span className="text-[11px] text-gray-400">—</span>
                                  return (
                                    <div className="inline-flex items-center gap-1">
                                      <DeadlineBadge deadlineDate={dl.earliest} compact />
                                      {dl.overdue > 0 && (
                                        <span className="text-[10px] font-bold text-rose-700 bg-rose-100 rounded-full px-1.5">
                                          +{dl.overdue}
                                        </span>
                                      )}
                                    </div>
                                  )
                                })()}
                              </Td>
                            </>
                          )}
                          <Td>
                            <div className="inline-flex items-start gap-1">
                              {/* The row he was sent here to sign off. The page
                                  scrolls to this row, so the button has to be
                                  HERE too — the banner up top is off-screen by
                                  the time he lands. */}
                              {isFocus && focusPending && focusSheetHref && (
                                <Link
                                  href={focusSheetHref}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-600 text-white hover:bg-amber-700 whitespace-nowrap"
                                >
                                  Approve <ArrowRight className="h-3 w-3" />
                                </Link>
                              )}
                              {/* Same rule as the phone card. (HOD #3) */}
                              {(sCompletedAt || canMarkComplete(bl)) && (
                                <CompleteControl
                                  projectId={project.id}
                                  disciplineId={d.id}
                                  subSkillId={s.id}
                                  label={`${s.code} ${s.name}`}
                                  savings={savingsOnCompletion(bl)}
                                  completedAt={sCompletedAt}
                                  completedByName={sCompletedBy}
                                  canWrite={canWrite}
                                  variant="row"
                                />
                              )}
                              {canWrite && (
                                <Link
                                  href={effMode === 'thumbrule'
                                    ? `/cost-control/working-sheets/new-thumbrule?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`
                                    : `/cost-control/working-sheets/new-quick?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-blue-300 text-blue-700 hover:bg-blue-50"
                                >
                                  <Plus className="h-3 w-3" /> Raise Budget Request
                                </Link>
                              )}
                              {/* Config (mode · remove) tucked behind one ▾ so the
                                  table stays KPIs + amounts, not editing widgets. */}
                              {canWrite && (
                                <RowConfigMenu>
                                  <RowConfigItem label="Estimation mode">
                                    <SubSkillModeCell
                                      projectId={project.id}
                                      subSkillId={s.id}
                                      initialMode={subMeta.get(s.id)?.mode ?? null}
                                      initialRate={subMeta.get(s.id)?.rate ?? null}
                                      initialNotes={subMeta.get(s.id)?.notes ?? null}
                                      inheritedMode={discMeta.get(d.id)?.mode ?? 'detailed'}
                                      canWrite={canWrite}
                                    />
                                  </RowConfigItem>
                                  <RowConfigItem label="Remove from project">
                                    <DisableButton
                                      projectId={project.id}
                                      subSkillId={s.id}
                                      label={`${s.code} ${s.name}`}
                                      attachedCount={wsCount}
                                      canWrite={canWrite}
                                    />
                                  </RowConfigItem>
                                </RowConfigMenu>
                              )}
                            </div>
                          </Td>
                        </tr>
                        {/* Item-wise BOQ — the same reading as the approval
                            screen, one level deeper. (HOD #8a) */}
                        <RowDetail id={s.id}>
                          <tr className="border-t border-gray-100 bg-gray-50/40">
                            <td colSpan={tableCols} className="px-3 py-3">
                              <SubSkillBoq sheets={boqBySub.get(`${d.id}::${s.id}`) ?? []} />
                            </td>
                          </tr>
                        </RowDetail>
                        </SubRow>
                      )
                    })}

                    {subs.length === 0 && !canAddStructure && (
                      <tr className="border-t border-gray-100">
                        <td colSpan={tableCols} className="pl-10 pr-3 py-2 text-xs italic text-gray-400">No sub-skills enabled for this discipline. Add via the setup wizard.</td>
                      </tr>
                    )}
                    {/* Same control as the phone card list, in the table's own
                        idiom. (HOD #6) */}
                    {canAddStructure && (
                      <tr className="border-t border-gray-100">
                        <td colSpan={tableCols} className="pl-10 pr-3 py-2">
                          <AddToProject
                            kind="sub"
                            size="small"
                            projectId={project.id}
                            disciplineId={d.id}
                            available={addableSubsByDiscipline.get(d.id) ?? []}
                          />
                        </td>
                      </tr>
                    )}
                    </CatRows>
                  </>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: the same Internal Estimate as stacked cards — the table above
            is far too wide for a phone. Read + navigate; heavy editing (mode,
            deadlines, IE decision, remove) stays on the desktop table. */}
        {/* A card stack has no header ROW to freeze, so the mobile equivalent is
            the category bar: it pins while you scroll that category's cards, so
            you always know which discipline the amounts belong to. Same
            mechanism as the desktop table — the list scrolls inside this box,
            because a page-scroll sticky cannot work under `main`'s overflow
            (see AGENTS.md). Each bar is pushed out by the next one. */}
        <div className="md:hidden divide-y divide-gray-100 overflow-auto max-h-[75vh]">
          {disciplines.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-gray-500">No disciplines enabled yet. Open the setup wizard to pick them.</p>
          )}
          {disciplines.map(d => {
            const dAgg = discAgg.get(d.id) ?? { budget: 0, wo: 0, paid: 0, approvedTotal: 0, estimate: 0, pending: 0 }
            const dOver = overBudgetAmount(dAgg)
            const subs = subSkills.filter(s => s.discipline_id === d.id)
            const cards = subs.map(s => {
              const a = wsAgg.get(`${d.id}::${s.id}`)
              const bl = blMap.get(`${d.id}::${s.id}`)
              const ie = ieMap.get(`${d.id}::${s.id}`)
              const estLive = a?.planTotal ?? 0
              const ask = a?.pendingAmount ?? 0
              const released = a?.approvedTotal ?? 0
              const wsCount = a?.chains.size ?? 0
              const baseline = estLive
              const overBy = baseline > 0 && ask > baseline ? ask - baseline : 0
              const sPct = bl && bl.budget > 0 ? (bl.paid / bl.budget) * 100 : 0
              const sOver = overBudgetAmount(bl)
              const sOverBy = overBudgetDriver(bl)
              const sCompletedAt = subMeta.get(s.id)?.completedAt ?? null
              const sCompletedBy = profileMap.get(subMeta.get(s.id)?.completedBy ?? '') ?? null
              const sEstShort = estimateShortfall(estLive, bl)
              const sNoEstimate = hasNoEstimate(estLive, bl)
              const isEmpty = estLive === 0 && ask === 0 && wsCount === 0
                && (bl?.budget ?? 0) === 0 && (bl?.wo ?? 0) === 0 && (bl?.paid ?? 0) === 0
              // Never hide the row the approver was deep-linked to, even if it
              // reads as empty — landing on "nothing here" would be worse.
              const isFocus = focusSub === s.id
              if (isEmpty && !isFocus) return null
              const effMode = subMeta.get(s.id)?.mode ?? discMeta.get(d.id)?.mode ?? 'detailed'
              return (
                <div
                  key={s.id}
                  id={`subm-${s.id}`}
                  className={`mx-3 my-2 rounded-xl border bg-white p-3.5 ${isFocus ? 'border-amber-400 ring-2 ring-amber-300' : 'border-gray-200'}`}
                >
                  {/* Name + sheets chip */}
                  <div className="flex items-start justify-between gap-2 mb-0.5">
                    <p className="text-sm text-gray-900 min-w-0">
                      <span className="font-mono text-[11px] text-gray-400 mr-1.5">{s.code}</span>{s.name}
                      <RowDetailToggle id={s.id} count={(boqBySub.get(`${d.id}::${s.id}`) ?? []).reduce((n, b) => n + b.rows.length, 0)} />
                      {(() => {
                        const t = adhocBySub.get(`${d.id}::${s.id}`)
                        if (!t || (t.adhoc === 0 && t.boq === 0)) return null
                        const isAdhoc = t.adhoc > 0
                        return (
                          <span
                            title={isAdhoc ? 'A budget here was declared adhoc — extra work outside the BOQ' : 'Every declared budget here is as per the BOQ estimate'}
                            className={`ml-1.5 align-middle inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-extrabold border ${isAdhoc ? 'bg-orange-50 text-orange-800 border-orange-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}
                          >
                            {isAdhoc ? 'ADHOC' : 'BOQ'}
                          </span>
                        )
                      })()}
                    </p>
                    {wsCount > 0 && (
                      <Link
                        href={`/cost-control/working-sheets?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`}
                        className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"
                      >
                        {wsCount} sheet{wsCount === 1 ? '' : 's'}
                      </Link>
                    )}
                  </div>

                  {/* Money read top-to-bottom, one line at a time — calmer than
                      three competing tiles. Estimate anchors; Awaiting is the
                      highlighted action; Released is the outcome. */}
                  <div className="flex items-center justify-between gap-3 py-1.5 border-t border-gray-100">
                    <span className="text-[13px] text-gray-600">Estimate</span>
                    <span className="text-[14px] font-semibold tabular-nums text-indigo-800 text-right"><Money amt={estLive} /></span>
                  </div>
                  {/* An estimate below what ERP already released is usually a
                      placeholder nobody filled in. Reported, never blocked. (HOD #5) */}
                  {sEstShort > 0 && (
                    <p className="-mt-0.5 mb-1 text-[11px] font-bold text-violet-700">
                      Estimate is {formatINR(sEstShort)} BELOW the ERP budget — it cannot be lower than what is already approved
                    </p>
                  )}
                  {sNoEstimate && (
                    <p className="-mt-0.5 mb-1 text-[11px] font-semibold text-violet-700">
                      No Internal Estimate set, but ERP has released {formatINR(bl?.budget ?? 0)}
                    </p>
                  )}
                  {ask > 0 && (() => {
                    const ids = awaitingBySub.get(`${d.id}::${s.id}`) ?? []
                    const href = awaitingHref(ids, `/cost-control/working-sheets?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`)
                    const cls = `flex items-center justify-between gap-3 -mx-1 my-1 px-2 py-1.5 rounded-lg ${overBy > 0 ? 'bg-rose-50' : 'bg-amber-50'}`
                    const body = (
                      <>
                        <span className={`text-[13px] font-semibold ${overBy > 0 ? 'text-rose-800' : 'text-amber-800'}`}>Awaiting your approval{href ? ' ›' : ''}</span>
                        <span className={`text-[14px] font-semibold tabular-nums text-right ${overBy > 0 ? 'text-rose-700' : 'text-amber-800'}`}><Money amt={ask} /></span>
                      </>
                    )
                    return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>
                  })()}
                  {overBy > 0 && (
                    <p className="text-[10px] font-semibold text-rose-600 mb-0.5">▲ over the Internal Estimate by {formatINR(overBy)}</p>
                  )}
                  {/* Same one-tap route into the voucher on the phone, where the
                      card — not the table row — is what he actually lands on. */}
                  {isFocus && focusPending && focusSheetHref && (
                    <Link
                      href={focusSheetHref}
                      className="mt-2 flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg bg-amber-600 text-white text-sm font-semibold"
                    >
                      Open the sheet to approve <ArrowRight className="h-4 w-4" />
                    </Link>
                  )}
                  {released > 0 && (
                    <div className="flex items-center justify-between gap-3 py-1.5 border-t border-gray-100">
                      <span className="text-[13px] text-gray-600">Budget approved in CT Hub</span>
                      <span className="text-[14px] font-semibold tabular-nums text-emerald-700 text-right"><Money amt={released} /></span>
                    </div>
                  )}

                  {/* Actuals (ERP) — one slim strip: % used headline + a bar +
                      the three amounts in a quiet caption. Replaces the old
                      four-cell grid that crowded the card. ERP-toggle-gated. */}
                  {showErp && ((bl?.budget ?? 0) > 0 || (bl?.wo ?? 0) > 0 || (bl?.paid ?? 0) > 0) && (
                    <div className="mt-2.5 pt-2.5 border-t border-gray-100">
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-gray-400">Actuals (ERP)</span>
                        {bl && bl.budget > 0
                          ? <span className={`text-[11px] font-semibold tabular-nums ${sOver > 0 ? 'text-rose-700' : sPct > 95 ? 'text-red-600' : sPct > 80 ? 'text-amber-700' : 'text-emerald-700'}`}>{sPct.toFixed(0)}% used</span>
                          : <span className="text-[11px] text-gray-400">No budget yet</span>}
                      </div>
                      {bl && bl.budget > 0 && (
                        <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className={`h-full rounded-full ${sOver > 0 ? 'bg-rose-600' : sPct > 95 ? 'bg-red-500' : sPct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(sPct, 100)}%` }} />
                        </div>
                      )}
                      {/* The desktop table says this in the "% Used" column; the
                          phone gets its own line so the two never disagree. (HOD #4) */}
                      {sOver > 0 && (
                        <p className="mt-1.5 text-[11px] font-bold text-rose-700">
                          Over the ERP budget by {formatINR(sOver)}
                          <span className="font-normal text-rose-600"> ({sOverBy === 'paid' ? 'already paid' : 'committed on WO/PO'})</span>
                        </p>
                      )}
                      <p className="mt-1.5 text-[11px] text-gray-500 tabular-nums leading-snug">
                        ERP Budget {formatINR(bl?.budget ?? 0)}{perSftInline(bl?.budget ?? 0)}
                        {(bl?.wo ?? 0) > 0 && <> · WO {formatINR(bl?.wo ?? 0)}{perSftInline(bl?.wo ?? 0)}</>}
                        {(bl?.paid ?? 0) > 0 && <> · Paid {formatINR(bl?.paid ?? 0)}{perSftInline(bl?.paid ?? 0)}</>}
                      </p>
                    </div>
                  )}

                  {/* Close the line — only where WO equals Paid, so most cards
                      never show this. Full-width 44px tap: this is the phone,
                      where nearly everyone reads this screen. (HOD #3) */}
                  {(sCompletedAt || canMarkComplete(bl)) && (
                    <CompleteControl
                      projectId={project.id}
                      disciplineId={d.id}
                      subSkillId={s.id}
                      label={`${s.code} ${s.name}`}
                      savings={savingsOnCompletion(bl)}
                      completedAt={sCompletedAt}
                      completedByName={sCompletedBy}
                      canWrite={canWrite}
                      variant="card"
                    />
                  )}

                  <RowDetail id={s.id}>
                    <div className="mt-2.5">
                      <SubSkillBoq sheets={boqBySub.get(`${d.id}::${s.id}`) ?? []} />
                    </div>
                  </RowDetail>

                  {canWrite && (
                    <div className="mt-3">
                      <Link
                        href={effMode === 'thumbrule'
                          ? `/cost-control/working-sheets/new-thumbrule?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`
                          : `/cost-control/working-sheets/new-quick?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-blue-300 text-blue-700"
                      >
                        <Plus className="h-3 w-3" /> Raise Budget Request
                      </Link>
                    </div>
                  )}
                </div>
              )
            }).filter(Boolean)
            if (cards.length === 0) return null
            return (
              <div key={d.id}>
                {/* Name on its own line, money underneath. Side by side, the
                    money block never shrinks and squeezed the name down to
                    "07 E." / "03 C.." on a 375px phone — the one thing on the
                    row you actually need to read. */}
                <div className="sticky top-0 z-10 px-4 py-2 bg-slate-50 border-t border-b border-gray-200">
                  <span className="flex items-center text-[13px] font-semibold text-gray-900">
                    <CatChevron catId={d.id} />
                    <span className="font-mono text-[11px] text-gray-500 mr-1.5">{d.code}</span>
                    <span>{d.name}</span>
                    {/* Same wording as the desktop "% Used" column — "net",
                        because sub-categories with budget left are netted off. */}
                    {dOver > 0 && (
                      <span className="ml-2 text-[10px] font-extrabold text-rose-600 whitespace-nowrap">
                        OVER {formatINR(dOver)} net
                      </span>
                    )}
                  </span>
                  {/* Three columns so each figure can carry its ₹/sft beneath —
                      the phone was the only place showing money with no rate. */}
                  <div className="mt-1 pl-6 grid grid-cols-3 gap-2 text-[11px] leading-tight tabular-nums">
                    <div>
                      <span className="text-gray-400">Est</span>{' '}
                      <span className="font-semibold text-indigo-800">{dAgg.estimate > 0 ? formatINR(dAgg.estimate) : '—'}</span>
                      {perSft(dAgg.estimate) && <span className="block text-[10px] text-gray-400">{perSft(dAgg.estimate)}</span>}
                    </div>
                    <div>
                      <span className="text-gray-400" title="Budget approved in CT Hub — through our own approval chain">CT Hub</span>{' '}
                      <span className="font-semibold text-emerald-700">{dAgg.approvedTotal > 0 ? formatINR(dAgg.approvedTotal) : '—'}</span>
                      {perSft(dAgg.approvedTotal) && <span className="block text-[10px] text-gray-400">{perSft(dAgg.approvedTotal)}</span>}
                    </div>
                    {showErp && (
                      <div>
                        {/* "ERP", not "Bud" — this figure comes from IN4 and the
                            KPI tile above calls it Approved Budget (ERP). */}
                        <span className="text-gray-400" title="Budget approved in ERP (IN4)">ERP</span>{' '}
                        <span className="font-semibold text-gray-800">{dAgg.budget > 0 ? formatINR(dAgg.budget) : '—'}</span>
                        {perSft(dAgg.budget) && <span className="block text-[10px] text-gray-400">{perSft(dAgg.budget)}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <div className="bg-gray-50/60">
                  <CatRows catId={d.id}>
                    {cards}
                    {/* Add a sub-category to THIS category, where he is already
                        looking at its rows. (HOD #6) */}
                    {canAddStructure && (
                      <div className="px-3 pb-3 pt-1">
                        <AddToProject
                          kind="sub"
                          projectId={project.id}
                          disciplineId={d.id}
                          available={addableSubsByDiscipline.get(d.id) ?? []}
                        />
                      </div>
                    )}
                  </CatRows>
                </div>
              </div>
            )
          })}
        </div>

        {/* Add a whole work category to the project. Outside the two layouts
            because it belongs to the table as a whole, not to either
            rendering of it. (HOD #6) */}
        {canAddStructure && (
          <div className="border-t border-gray-100 px-3 py-3">
            <AddToProject
              kind="discipline"
              projectId={project.id}
              available={addableDisciplines}
            />
          </div>
        )}
      </div>
      </RowDetailProvider>
      </TreeProvider>

      {/* Engineers strip */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Engineers on this project</h2>
        {engineers.length === 0 ? (
          <p className="text-sm text-gray-500">No engineers assigned yet. Reopen the setup wizard from the banner to assign.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {engineers.map(e => {
              const dCodes = disciplines.filter(d => e.discipline_ids.includes(d.id)).map(d => d.code)
              return (
                <div key={e.user_id} className="rounded-md border border-gray-200 p-3">
                  <p className="font-semibold text-sm text-gray-900">{e.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {dCodes.length > 0 ? dCodes.join(', ') : 'no disciplines yet'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Tip */}
      <div className="rounded-md border-l-4 border-blue-500 bg-blue-50 px-4 py-3 text-sm text-blue-900 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
        <p>
          Click <b>+ Raise Budget Request</b> on any sub-category row to start a Working Sheet pre-filled with that discipline & sub-skill.
          Budget / WO / Paid columns will fill in automatically once you import the ENGG_CONSOLIDATED_BUDGET_REPORT
          (or after Working Sheets get approved and bills land).
        </p>
      </div>
    </div>
  )
}

// ============================================================
// Small inline cell helpers — keeps the table markup readable
// ============================================================

function Th({
  children, align = 'left', className = '',
}: { children?: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    // Sticky lives on the CELLS, not the <thead> — and the cell carries its own
    // opaque background + bottom border, or rows scroll through underneath it.
    <th className={`sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2.5 text-${align} font-semibold text-[10px] uppercase tracking-wide text-gray-500 ${className}`}>
      {children}
    </th>
  )
}

function Td({
  children, align = 'left', mono = false, className = '',
}: { children?: React.ReactNode; align?: 'left' | 'right'; mono?: boolean; className?: string }) {
  return (
    <td className={`px-3 py-2 text-${align} ${mono ? 'tabular-nums' : ''} ${className}`}>
      {children}
    </td>
  )
}

function KPI({
  label, value, sub, tone, perSft,
}: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone: 'blue' | 'purple' | 'orange' | 'green' | 'indigo' | 'amber'; perSft?: string | null }) {
  const top = {
    blue: 'border-t-blue-500',
    purple: 'border-t-purple-500',
    orange: 'border-t-orange-500',
    green: 'border-t-green-500',
    indigo: 'border-t-indigo-500',
    amber: 'border-t-amber-500',
  }[tone]
  return (
    <div className={`bg-white rounded-md border border-gray-200 border-t-2 ${top} p-4`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
      {perSft && <p className="text-[11px] font-semibold text-gray-600 tabular-nums">{perSft}</p>}
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}
