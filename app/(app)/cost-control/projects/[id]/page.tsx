import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile } from '@/lib/auth'
import { checkIsCcReviewer, checkCanDecideInternalEstimate, checkCanRequestIeRevision } from '@/components/cost-control/ws-actions'
import { IeRevisionPanel, type IeRevision } from './IeRevisionPanel'
import { EngineerProjectView } from './EngineerProjectView'
import { ProjectApproversPanel } from './ProjectApproversPanel'
import { PageHeader } from '@/components/PageHeader'
import { SetupProgressBanner } from '@/components/ProjectSetupWizard/SetupProgressBanner'
import { Plus, Flame, Info, Settings } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { getCcSettings } from '@/lib/cost-control/settings'
import { QueryError } from '@/components/ui/query-error'
import { DeadlineBadge } from '@/components/cost-control/DeadlineBadge'
import { wsStatusLabel } from '@/components/cost-control/WSStatusPill'
import { DeadlineCell, SubSkillModeCell, DisableButton, InternalEstimateDecision, SubSkillAssignControl } from './RowControls'
import { AreaChip } from './AreaChip'
import { RenameProjectChip } from './RenameProjectChip'
import { ProjectAliasChip } from './ProjectAliasChip'
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
}

export default async function CostControlProjectDetailPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const perms = await requirePermission('cost-control', 'view')
  const { id } = await params

  const supabase = await createClient()
  const ccSettings = await getCcSettings()
  const reviewer = await checkIsCcReviewer()
  // Renaming a project is admin-only — the name shows on every module.
  const isAdmin = (await getMyProfile())?.role === 'admin'
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
          <Link href="/cost-control" className="text-blue-600 hover:underline">← Cost Control</Link>
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
      .select('sub_skill_id, estimation_mode, thumbrule_rate_per_sft, thumbrule_notes, target_deadline, cc_sub_skills(id, discipline_id, code, name)')
      .eq('project_id', id)
      .eq('is_enabled', true),
    supabase
      .from('cc_budget_lines')
      .select('discipline_id, sub_skill_id, line_type, current_budget_amt, current_wo_committed_amt, current_paid_amt, internal_estimate_amt, internal_estimate_set_at, internal_estimate_notes')
      .eq('project_id', id),
    supabase
      .from('cc_working_sheets')
      .select('id, discipline_id, sub_skill_id, status, total_amount, approved_for_erp_amt, deadline_date, entry_mode, summary_notes, in4_entered_at')
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

  // Which engineer is responsible for each sub-skill's budget working.
  const { data: ssaData } = await supabase
    .from('cc_subskill_assignments')
    .select('sub_skill_id, engineer_id')
    .eq('project_id', id)
  const assigneeBySub = new Map<string, string>()
  for (const r of (ssaData ?? []) as Array<{ sub_skill_id: string; engineer_id: string }>) {
    assigneeBySub.set(r.sub_skill_id, r.engineer_id)
  }

  // Budget lines + working sheets drive every number on this page. If
  // either query broke, zeros would masquerade as "no budget yet" — stop
  // and say so instead.
  if (blRes.error || wsRes.error) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        <div className="flex items-center gap-2 text-xs">
          <Link href="/cost-control" className="text-blue-600 hover:underline">← Cost Control</Link>
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
    cc_sub_skills: SubSkillRow | SubSkillRow[] | null
  }

  const disciplines: DisciplineRow[] = ((projDisRes.data ?? []) as ProjDisJoin[])
    .map(r => Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines)
    .filter((d): d is DisciplineRow => !!d)
    .sort((a, b) => a.display_order - b.display_order)

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
  const subMeta = new Map<string, { mode: 'detailed' | 'thumbrule' | null; rate: number | null; notes: string | null; deadline: string | null }>()
  for (const r of (projSubRes.data ?? []) as ProjSubJoin[]) {
    subMeta.set(r.sub_skill_id, {
      mode: r.estimation_mode, // null = inherit
      rate: r.thumbrule_rate_per_sft,
      notes: r.thumbrule_notes,
      deadline: r.target_deadline,
    })
  }

  // Look up budget lines by (discipline_id, sub_skill_id) — sub_skill_id
  // null means the category row. The same pair can carry several rows
  // (one per line_type: work / advance / …), so SUM the amounts across
  // them — keeping only the last row would silently drop the others.
  const blMap = new Map<string, { budget: number; wo: number; paid: number }>()
  for (const b of (blRes.data ?? []) as BudgetLine[]) {
    const k = `${b.discipline_id}::${b.sub_skill_id ?? '_root'}`
    const cur = blMap.get(k) ?? { budget: 0, wo: 0, paid: 0 }
    cur.budget += Number(b.current_budget_amt ?? 0)
    cur.wo     += Number(b.current_wo_committed_amt ?? 0)
    cur.paid   += Number(b.current_paid_amt ?? 0)
    blMap.set(k, cur)
  }

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

  // Working-sheet aggregates per sub-skill.
  //
  // Two DIFFERENT things live in a sub-skill and must never be added
  // together:
  //   • the imported Internal Estimate baseline — sheets tagged "[IB…]",
  //     the amounts management uploaded from Excel; and
  //   • engineers' own sheets — their "ask", which runs through approval.
  // They can even share a version chain (an engineer's ask is saved as a
  // later version of the same sub-skill+line the [IB] baseline seeded).
  // And every sheet keeps its OLD versions live. Summing all live rows
  // therefore (a) counted an engineer's ask into the estimate and (b)
  // counted a 6-times-revised sheet six times. Fix:
  //   1. classify each live sheet as baseline ([IB]) vs engineer, then
  //   2. within each class keep only the LATEST version of each chain.
  // `planTotal` = the Internal Estimate baseline (latest [IB] per chain);
  // pending/approved come from engineers' latest sheets only.
  const chainOf = new Map<string, { anchor: string; ver: number }>()
  for (const r of (verRes.data ?? []) as { id: string; chain_anchor_id: string | null; version_no: number | null }[]) {
    if (r.chain_anchor_id) chainOf.set(r.id, { anchor: r.chain_anchor_id, ver: Number(r.version_no ?? 1) })
  }
  const liveRows = ((wsRes.data ?? []) as WSAgg[]).filter(w => w.status !== 'cancelled')
  // Latest [IB] and latest engineer sheet per chain. Sheets with no chain
  // info (shouldn't happen) fall back to their own id as a singleton chain.
  const latestIB = new Map<string, { w: WSAgg; ver: number }>()
  const latestEng = new Map<string, { w: WSAgg; ver: number }>()
  for (const w of liveRows) {
    const ch = chainOf.get(w.id) ?? { anchor: w.id, ver: 1 }
    const bag = (w.summary_notes ?? '').startsWith('[IB') ? latestIB : latestEng
    const prev = bag.get(ch.anchor)
    if (!prev || ch.ver > prev.ver) bag.set(ch.anchor, { w, ver: ch.ver })
  }

  const wsAgg = new Map<string, { approvedTotal: number; pendingAmount: number; planTotal: number; chains: Set<string> }>()
  const ensureAgg = (k: string) => {
    let cur = wsAgg.get(k)
    if (!cur) { cur = { approvedTotal: 0, pendingAmount: 0, planTotal: 0, chains: new Set<string>() }; wsAgg.set(k, cur) }
    return cur
  }
  // Internal Estimate baseline = latest [IB] sheet per chain.
  for (const { w } of latestIB.values()) {
    const cur = ensureAgg(`${w.discipline_id}::${w.sub_skill_id}`)
    cur.planTotal += Number(w.total_amount ?? 0)
    cur.chains.add(chainOf.get(w.id)?.anchor ?? w.id)
  }
  // Engineers' latest sheets → pending / approved (never their old versions).
  const PENDING_STATUS = new Set(['submitted', 'ph_approved', 'atm_approved'])
  for (const { w } of latestEng.values()) {
    const cur = ensureAgg(`${w.discipline_id}::${w.sub_skill_id}`)
    cur.chains.add(chainOf.get(w.id)?.anchor ?? w.id)
    const amt = Number(w.total_amount ?? 0)
    const appr = Number(w.approved_for_erp_amt ?? 0)
    if (w.status === 'approved' || w.status === 'wo_issued' || w.status === 'paid') {
      cur.approvedTotal += appr > 0 ? appr : amt
    } else if (w.status === 'partially_approved') {
      // Some releases approved, more to come: released portion counts as
      // approved, remainder stays pending.
      cur.approvedTotal += appr
      cur.pendingAmount += Math.max(amt - appr, 0)
    } else if (PENDING_STATUS.has(w.status)) {
      // Anywhere in the sign-off chain = still pending release. A partly
      // released sheet re-requesting its balance keeps its released money
      // counted as approved; only the balance stays pending.
      cur.approvedTotal += appr
      cur.pendingAmount += Math.max(amt - appr, 0)
    }
    // draft / returned / draft_blocked add nothing but the chain count.
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

  // Disciplines-level rollups. Budget can live at two granularities:
  //   1. Per-sub-skill lines — the granular ones (WS approvals, or a BPH
  //      report that has sub-skill detail rows).
  //   2. Discipline-root line (sub_skill_id NULL) — a BPH discipline
  //      SUMMARY row, or an Excel import that lacked sub-skill codes.
  //
  // CRITICAL: never add BOTH for the same discipline. A BPH report often
  // carries a "03 Civil" summary row AND its "0301 …" detail rows; the
  // summary is the PARENT total of the details, so counting both doubles
  // the budget. Rule: if a discipline has ANY sub-skill budget line, use
  // those and IGNORE its root line; only fall back to the root line when
  // there are no sub-skill lines.
  const discAgg = new Map<string, { budget: number; wo: number; paid: number; approvedTotal: number; estimate: number; pending: number }>()
  for (const d of disciplines) discAgg.set(d.id, { budget: 0, wo: 0, paid: 0, approvedTotal: 0, estimate: 0, pending: 0 })

  // Track which disciplines have at least one sub-skill budget line.
  const discHasSubSkillBudget = new Set<string>()

  for (const s of subSkills) {
    const bl = blMap.get(`${s.discipline_id}::${s.id}`)
    const a = wsAgg.get(`${s.discipline_id}::${s.id}`) ?? { approvedTotal: 0, planTotal: 0, pendingAmount: 0 }
    const cur = discAgg.get(s.discipline_id)
    if (cur) {
      const subBudget = bl?.budget ?? 0
      if (bl && (subBudget !== 0 || bl.wo !== 0 || bl.paid !== 0)) {
        discHasSubSkillBudget.add(s.discipline_id)
      }
      cur.budget += subBudget
      cur.wo    += bl?.wo ?? 0
      cur.paid  += bl?.paid ?? 0
      cur.approvedTotal += a.approvedTotal
      cur.estimate += a.planTotal
      cur.pending += a.pendingAmount
    }
  }
  // Add the discipline-root line ONLY when no sub-skill budget exists for
  // that discipline — otherwise it would double-count the summary on top
  // of its own detail rows.
  for (const d of disciplines) {
    if (discHasSubSkillBudget.has(d.id)) continue
    const blRoot = blMap.get(`${d.id}::_root`)
    if (!blRoot) continue
    const cur = discAgg.get(d.id)
    if (cur) {
      cur.budget += blRoot.budget
      cur.wo    += blRoot.wo
      cur.paid  += blRoot.paid
    }
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

  // Per-project approvers roster (Phase 1) + candidate users to assign.
  const [approverRes, candRes] = await Promise.all([
    supabase.from('cc_project_approvers').select('role, user_id').eq('project_id', id),
    supabase.from('profiles').select('id, full_name, name').eq('is_active', true).order('full_name'),
  ])
  const projectApprovers = ((approverRes.data ?? []) as Array<{ role: 'project_head' | 'head' | 'founder'; user_id: string }>)
    .map(r => ({ role: r.role, user_id: r.user_id, name: profileMap.get(r.user_id) ?? '(user)' }))
  const approverCandidates = ((candRes.data ?? []) as ProfileLite[])
    .map(p => ({ id: p.id, name: p.full_name ?? p.name ?? '(unnamed)' }))

  // Is this project mapped to a BPH report? Drives the header sync button.
  const isBphMapped = !!(await getBphMappingForProject(id))

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
  const perSft = (amt: number): string | null =>
    ccSettings.show_per_sft && sft > 0 && amt > 0
      ? `₹${Math.round(amt / sft).toLocaleString('en-IN')}/sft`
      : null
  // Visible column count for empty-state rows (name + Internal Estimate +
  // Awaiting Approval + Working Sheets + actions, plus the toggleable ERP
  // and deadline groups).
  const tableCols = 5 + (showErp ? 4 : 0) + (ccSettings.show_deadlines ? 2 : 0)

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
        <Link href="/cost-control" className="text-blue-600 hover:underline">← Cost Control</Link>
        {parent && (
          <>
            <span className="text-gray-300">/</span>
            <span className="text-gray-500">{parent.name} ({parent.code})</span>
          </>
        )}
      </div>

      {/* Title + actions */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <PageHeader
            title={project.name}
            subtitle={[
              project.code,
              pmName ? `Owner: ${pmName}` : null,
              project.start_date ? `Started ${new Date(project.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : null,
            ].filter(Boolean).join(' · ')}
            className="mb-0"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RenameProjectChip projectId={project.id} name={project.name} isAdmin={isAdmin} />
          <ProjectAliasChip projectId={project.id} code={project.code} isAdmin={isAdmin} />
          <AreaChip
            projectId={project.id}
            sft={project.built_up_sft != null ? Number(project.built_up_sft) : null}
            canWrite={canWrite}
          />
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
                href={`/cost-control/working-sheets/new?project=${project.id}`}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" /> New Working Sheet
              </Link>
              <BphSyncButton projectId={project.id} isMapped={isBphMapped} />
              <Link
                href={`/cost-control/projects/${project.id}/setup`}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-white text-gray-700 border border-gray-300 text-sm font-semibold hover:bg-gray-50"
                title="Re-open the setup wizard to add/remove disciplines, sub-skills or engineers"
              >
                <Settings className="h-4 w-4" /> Edit Setup
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Internal Estimate lock + revision workflow (management only) */}
      {reviewer && (
        <IeRevisionPanel
          projectId={project.id}
          lockState={lockState}
          revision={ieRevision}
          canRequest={canRequestRevision}
          canDecide={canDecideRevision}
        />
      )}

      {/* Per-project approvers (Phase 1 — roster only; scoping comes next). */}
      {reviewer && (
        <ProjectApproversPanel
          projectId={project.id}
          approvers={projectApprovers}
          candidates={approverCandidates}
          canWrite={canWrite}
        />
      )}

      {/* Pending-approval shortcut — covers EVERY sheet type (submitted or
          partially approved). Hides itself when nothing is pending. */}
      {pendingCount > 0 && canWrite && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm font-semibold text-amber-900 inline-flex items-center gap-2">
              <Flame className="h-4 w-4" />
              {pendingCount} working sheet{pendingCount === 1 ? '' : 's'} awaiting approval
              {pendingTotal > 0 && (
                <span className="text-xs font-normal text-amber-700">· {formatINR(pendingTotal)} yet to be released</span>
              )}
            </p>
            <span className="inline-flex items-center gap-3 flex-wrap">
              <Link
                href={`/cost-control/working-sheets?project=${project.id}`}
                className="text-xs font-semibold text-amber-700 hover:underline"
              >
                Review now →
              </Link>
              {pendingThumbruleCount > 0 && (
                <Link
                  href={`/cost-control/approvals/thumbrule?project=${project.id}`}
                  className="text-xs font-semibold text-amber-700 hover:underline"
                >
                  Bulk approve {pendingThumbruleCount} Thumbrule sheet{pendingThumbruleCount === 1 ? '' : 's'} →
                </Link>
              )}
            </span>
          </div>
        </div>
      )}

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
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${showErp ? 'lg:grid-cols-6' : ''} gap-3`}>
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
                      Fills when Heads approve releases.{' '}
                      <Link
                        href={`/cost-control/import/bph?cc_project=${project.id}`}
                        className="text-teal-700 hover:underline font-medium"
                      >
                        Or pull from your BPH report →
                      </Link>
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
        <KPI label="Approved via WS" value={formatINR(totalApproved)} perSft={perSft(totalApproved)}
             sub={totalEstimate > 0
               ? `${Math.round((totalApproved / totalEstimate) * 100)}% of estimate`
               : "From this app's Working Sheets"} tone="green" />
      </div>

      {showSetupBanner && (
        <SetupProgressBanner projectId={project.id} progressPct={setupPct} />
      )}

      {/* THE TABLE — discipline categories + sub-skill rows. ERP columns
          (Budget vs Actual) and deadline columns follow the settings toggles. */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-left">
              <tr>
                <Th className="min-w-[280px]">Work Category / Sub-skill</Th>
                <Th align="right" className="w-32">Internal Estimate</Th>
                <Th align="right" className="w-32">Awaiting Approval</Th>
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
                        <span className="font-mono text-[11px] text-gray-500 mr-2">{d.code}</span>
                        <span className="text-gray-900">{d.name}</span>
                        {dHot && <Flame className="inline h-3.5 w-3.5 text-orange-500 ml-2" />}
                      </td>
                      <Td align="right" mono className="text-indigo-800">
                        <Money amt={dAgg.estimate} />
                      </Td>
                      <Td align="right" mono className="text-amber-700">
                        <Money amt={dAgg.pending} />
                      </Td>
                      {showErp && (
                        <>
                          <Td align="right" mono><Money amt={dAgg.budget} /></Td>
                          <Td align="right" mono className="text-gray-600"><Money amt={dAgg.wo} /></Td>
                          <Td align="right" mono className="text-gray-600"><Money amt={dAgg.paid} /></Td>
                          <Td align="right" className={dPct > 95 ? 'text-red-600' : dPct > 80 ? 'text-amber-700' : 'text-green-700'}>
                            {dAgg.budget > 0 ? `${dPct.toFixed(0)}%` : '—'}
                          </Td>
                        </>
                      )}
                      <Td>{/* category-level WS counts not shown */}</Td>
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

                    {subs.map(s => {
                      const bl = blMap.get(`${d.id}::${s.id}`)
                      const a = wsAgg.get(`${d.id}::${s.id}`)
                      const sPct = bl && bl.budget > 0
                        ? (bl.paid / bl.budget) * 100
                        : 0
                      const sHot = sPct > 95
                      const wsCount = a?.chains.size ?? 0
                      const ie = ieMap.get(`${d.id}::${s.id}`)
                      const estLive = a?.planTotal ?? 0
                      const ask = a?.pendingAmount ?? 0
                      // estLive is now the Internal Estimate baseline alone
                      // (the latest [IB] upload) — no longer mixed with the
                      // engineer's ask — so compare the ask straight against
                      // it. A Trustee-accepted amount still wins.
                      const baseline = ie?.decision === 'accepted' && ie.amt != null
                        ? ie.amt
                        : estLive
                      const overBy = baseline > 0 && ask > baseline ? ask - baseline : 0
                      return (
                        <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                          <td className="pl-10 pr-3 py-2 text-gray-700">
                            <span className="font-mono text-[11px] text-gray-400 mr-2">{s.code}</span>
                            <span>{s.name}</span>
                            {sHot && <Flame className="inline h-3 w-3 text-orange-500 ml-1.5" />}
                            <span className="ml-2 inline-block align-middle">
                              <SubSkillModeCell
                                projectId={project.id}
                                subSkillId={s.id}
                                initialMode={subMeta.get(s.id)?.mode ?? null}
                                initialRate={subMeta.get(s.id)?.rate ?? null}
                                initialNotes={subMeta.get(s.id)?.notes ?? null}
                                inheritedMode={discMeta.get(d.id)?.mode ?? 'detailed'}
                                canWrite={canWrite}
                              />
                            </span>
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
                            {canWrite && (
                              <div className="mt-1">
                                <SubSkillAssignControl
                                  projectId={project.id}
                                  subSkillId={s.id}
                                  engineerId={assigneeBySub.get(s.id) ?? null}
                                  assignedName={assigneeBySub.get(s.id) ? (profileMap.get(assigneeBySub.get(s.id)!) ?? null) : null}
                                  engineers={engineers.map(e => ({ user_id: e.user_id, name: e.name }))}
                                />
                              </div>
                            )}
                          </td>
                          <Td align="right" mono className="text-indigo-800">
                            <Money amt={estLive} />
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
                            <Money amt={ask} />
                            {overBy > 0 && (
                              <span className="block text-[10px] font-bold text-rose-600 leading-tight"
                                title={`Engineer is asking ${formatINR(overBy)} above the Internal Estimate`}>
                                ▲ over by {formatINR(overBy)}
                              </span>
                            )}
                          </Td>
                          {showErp && (
                            <>
                              <Td align="right" mono><Money amt={bl?.budget ?? 0} /></Td>
                              <Td align="right" mono className="text-gray-600"><Money amt={bl?.wo ?? 0} /></Td>
                              <Td align="right" mono className="text-gray-600"><Money amt={bl?.paid ?? 0} /></Td>
                              <Td align="right" className={sPct > 95 ? 'text-red-600 font-semibold' : sPct > 80 ? 'text-amber-700 font-semibold' : sPct > 0 ? 'text-green-700 font-semibold' : 'text-gray-400'}>
                                {bl && bl.budget > 0 ? `${sPct.toFixed(0)}%` : '—'}
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
                            <div className="inline-flex items-center gap-1">
                              {canWrite && (() => {
                                // Route to the thumbrule form when this
                                // sub-skill's effective mode is thumbrule
                                // (own override, else inherited from the
                                // discipline) — pre-filled with project +
                                // discipline + sub-skill. Otherwise the
                                // normal BOQ flow.
                                const effMode = subMeta.get(s.id)?.mode ?? discMeta.get(d.id)?.mode ?? 'detailed'
                                const href = effMode === 'thumbrule'
                                  ? `/cost-control/working-sheets/new-thumbrule?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`
                                  : `/cost-control/working-sheets/new?project=${project.id}&discipline=${d.id}&sub_skill=${s.id}`
                                return (
                                  <Link
                                    href={href}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border border-blue-300 text-blue-700 hover:bg-blue-50"
                                  >
                                    <Plus className="h-3 w-3" /> New WS
                                  </Link>
                                )
                              })()}
                              <DisableButton
                                projectId={project.id}
                                subSkillId={s.id}
                                label={`${s.code} ${s.name}`}
                                attachedCount={wsCount}
                                canWrite={canWrite}
                              />
                            </div>
                          </Td>
                        </tr>
                      )
                    })}

                    {subs.length === 0 && (
                      <tr className="border-t border-gray-100">
                        <td colSpan={tableCols} className="pl-10 pr-3 py-2 text-xs italic text-gray-400">No sub-skills enabled for this discipline. Add via the setup wizard.</td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

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
          Click <b>+ New WS</b> on any sub-skill row to start a Working Sheet pre-filled with that discipline & sub-skill.
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
    <th className={`px-3 py-2.5 text-${align} font-semibold text-[10px] uppercase tracking-wide text-gray-500 ${className}`}>
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
