import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { SetupProgressBanner } from '@/components/ProjectSetupWizard/SetupProgressBanner'
import { Plus, Flame, Info, Settings } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { QueryError } from '@/components/ui/query-error'
import { DeadlineBadge } from '@/components/cost-control/DeadlineBadge'
import { wsStatusLabel } from '@/components/cost-control/WSStatusPill'
import { DeadlineCell, SubSkillModeCell, DisableButton } from './RowControls'
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
}
interface WSAgg {
  discipline_id: string
  sub_skill_id: string
  status: string
  total_amount: number | null
  approved_for_erp_amt: number | null
  deadline_date: string | null
  entry_mode: 'line_items' | 'excel_summary' | 'thumbrule' | null
}

export default async function CostControlProjectDetailPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const perms = await requirePermission('cost-control', 'view')
  const canWrite = can(perms, 'cost-control', 'edit')
  const { id } = await params
  const supabase = await createClient()

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
      .select('discipline_id, sub_skill_id, line_type, current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', id),
    supabase
      .from('cc_working_sheets')
      .select('discipline_id, sub_skill_id, status, total_amount, approved_for_erp_amt, deadline_date, entry_mode')
      .eq('project_id', id),
    supabase
      .from('project_assignments')
      .select('user_id, role, assigned_disciplines')
      .eq('project_id', id)
      .eq('role', 'engineer'),
    supabase.from('profiles').select('id, full_name, name'),
  ])

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

  // Working-sheet aggregates per sub-skill. `planTotal` = the Internal
  // Estimate, computed live as the sum of EVERY working-sheet total
  // except cancelled ones. HOD reads this to decide what to release in
  // ERP — they don't type the estimate themselves.
  const wsAgg = new Map<string, { approvedCount: number; approvedTotal: number; draftCount: number; submittedCount: number; partialCount: number; pendingAmount: number; planTotal: number }>()
  for (const w of (wsRes.data ?? []) as WSAgg[]) {
    const k = `${w.discipline_id}::${w.sub_skill_id}`
    const cur = wsAgg.get(k) ?? { approvedCount: 0, approvedTotal: 0, draftCount: 0, submittedCount: 0, partialCount: 0, pendingAmount: 0, planTotal: 0 }
    const amt = Number(w.total_amount ?? 0)
    const appr = Number(w.approved_for_erp_amt ?? 0)
    if (w.status === 'approved' || w.status === 'wo_issued' || w.status === 'paid') {
      cur.approvedCount += 1
      cur.approvedTotal += appr > 0 ? appr : amt
    } else if (w.status === 'partially_approved') {
      // Some releases approved, more to come: the released portion counts
      // as approved, the remainder stays pending.
      cur.partialCount += 1
      cur.approvedTotal += appr
      cur.pendingAmount += Math.max(amt - appr, 0)
    } else if (w.status === 'submitted') {
      cur.submittedCount += 1
      cur.pendingAmount += Math.max(amt - appr, 0)
    } else if (w.status === 'draft' || w.status === 'returned' || w.status === 'draft_blocked') {
      cur.draftCount += 1
    }
    if (w.status !== 'cancelled') {
      cur.planTotal += amt
    }
    wsAgg.set(k, cur)
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
  const discAgg = new Map<string, { budget: number; wo: number; paid: number; approvedTotal: number; estimate: number }>()
  for (const d of disciplines) discAgg.set(d.id, { budget: 0, wo: 0, paid: 0, approvedTotal: 0, estimate: 0 })

  // Track which disciplines have at least one sub-skill budget line.
  const discHasSubSkillBudget = new Set<string>()

  for (const s of subSkills) {
    const bl = blMap.get(`${s.discipline_id}::${s.id}`)
    const a = wsAgg.get(`${s.discipline_id}::${s.id}`) ?? { approvedTotal: 0, planTotal: 0 }
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

  // Is this project mapped to a BPH report? Drives the header sync button.
  const isBphMapped = !!(await getBphMappingForProject(id))

  const setupPct = project.setup_progress_pct ?? 0
  const showSetupBanner = setupPct < 100 && project.cc_status === 'setup_incomplete'

  // Sheets in THIS project still awaiting (further) approval — submitted
  // or partially approved. Drives one shortcut banner; when thumbrule
  // sheets are among them, the bulk-approve page gets a secondary link.
  const pendingSheets = ((wsRes.data ?? []) as WSAgg[]).filter(w =>
    w.status === 'submitted' || w.status === 'partially_approved',
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
              project.built_up_sft ? `${project.built_up_sft.toLocaleString('en-IN')} sft` : null,
              pmName ? `Owner: ${pmName}` : null,
              project.start_date ? `Started ${new Date(project.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : null,
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
        const gap = totalApproved - totalBudget
        if (gap <= 0 || totalApproved === 0) return null
        return (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
            <Info className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              <b>{formatINR(gap)}</b> approved here but not yet in IN4 — push it through IN4,
              then your next BPH upload will bring this in line.
            </span>
          </div>
        )
      })()}

      {/* KPI strip — portfolio-level numbers for this project */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPI
          label="Internal Estimate"
          value={totalEstimate > 0 ? formatINR(totalEstimate) : '—'}
          sub={totalEstimate > 0 ? 'Sum of all Working Sheets (live)' : 'Will populate once WSes are raised'}
          tone="indigo"
        />
        <KPI
          label="Approved Budget (ERP)"
          value={formatINR(totalBudget)}
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
        <KPI label="Committed (WO/PO)" value={formatINR(totalWO)}
             sub={totalBudget > 0 ? `${Math.round((totalWO / totalBudget) * 100)}% of budget` : '—'} tone="purple" />
        <KPI label="Paid to Date" value={formatINR(totalPaid)}
             sub={totalBudget > 0 ? `${utilPct}% utilized` : '—'} tone="orange" />
        <KPI label="Approved via WS" value={formatINR(totalApproved)}
             sub={totalEstimate > 0
               ? `${Math.round((totalApproved / totalEstimate) * 100)}% of estimate`
               : "From this app's Working Sheets"} tone="green" />
      </div>

      {showSetupBanner && (
        <SetupProgressBanner projectId={project.id} progressPct={setupPct} />
      )}

      {/* THE TABLE — discipline categories + sub-skill rows */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-left">
              <tr>
                <Th className="min-w-[280px]">Work Category / Sub-skill</Th>
                <Th align="right" className="w-32">Estimate</Th>
                <Th align="right">Budget (ERP)</Th>
                <Th align="right">WO / PO</Th>
                <Th align="right">Paid</Th>
                <Th align="right" className="w-20">% Used</Th>
                <Th className="w-28">Working Sheets</Th>
                <Th className="w-44">Plan Deadline</Th>
                <Th className="w-28">WS Status</Th>
                <Th className="w-28"></Th>
              </tr>
            </thead>
            <tbody>
              {disciplines.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-500">No disciplines enabled. Open the setup wizard to pick them.</td></tr>
              )}

              {disciplines.map(d => {
                const dAgg = discAgg.get(d.id) ?? { budget: 0, wo: 0, paid: 0, approvedTotal: 0, estimate: 0 }
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
                  if (sAgg) dWsCount += sAgg.approvedCount + sAgg.partialCount + sAgg.draftCount + sAgg.submittedCount
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
                        {dAgg.estimate > 0 ? formatINR(dAgg.estimate) : '—'}
                      </Td>
                      <Td align="right" mono>{dAgg.budget > 0 ? formatINR(dAgg.budget) : '—'}</Td>
                      <Td align="right" mono className="text-gray-600">{dAgg.wo > 0 ? formatINR(dAgg.wo) : '—'}</Td>
                      <Td align="right" mono className="text-gray-600">{dAgg.paid > 0 ? formatINR(dAgg.paid) : '—'}</Td>
                      <Td align="right" className={dPct > 95 ? 'text-red-600' : dPct > 80 ? 'text-amber-700' : 'text-green-700'}>
                        {dAgg.budget > 0 ? `${dPct.toFixed(0)}%` : '—'}
                      </Td>
                      <Td>{/* category-level WS counts not shown */}</Td>
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
                      const wsCount = (a?.approvedCount ?? 0) + (a?.partialCount ?? 0) + (a?.draftCount ?? 0) + (a?.submittedCount ?? 0)
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
                          </td>
                          <Td align="right" mono className="text-indigo-800">
                            {a && a.planTotal > 0 ? formatINR(a.planTotal) : '—'}
                          </Td>
                          <Td align="right" mono>{bl?.budget ? formatINR(bl.budget) : '—'}</Td>
                          <Td align="right" mono className="text-gray-600">{bl?.wo ? formatINR(bl.wo) : '—'}</Td>
                          <Td align="right" mono className="text-gray-600">{bl?.paid ? formatINR(bl.paid) : '—'}</Td>
                          <Td align="right" className={sPct > 95 ? 'text-red-600 font-semibold' : sPct > 80 ? 'text-amber-700 font-semibold' : sPct > 0 ? 'text-green-700 font-semibold' : 'text-gray-400'}>
                            {bl && bl.budget > 0 ? `${sPct.toFixed(0)}%` : '—'}
                          </Td>
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
                                  : `/cost-control/working-sheets/new?project=${project.id}`
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
                        <td colSpan={10} className="pl-10 pr-3 py-2 text-xs italic text-gray-400">No sub-skills enabled for this discipline. Add via the setup wizard.</td>
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
  label, value, sub, tone,
}: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone: 'blue' | 'purple' | 'orange' | 'green' | 'indigo' }) {
  const top = {
    blue: 'border-t-blue-500',
    purple: 'border-t-purple-500',
    orange: 'border-t-orange-500',
    green: 'border-t-green-500',
    indigo: 'border-t-indigo-500',
  }[tone]
  return (
    <div className={`bg-white rounded-md border border-gray-200 border-t-2 ${top} p-4`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}
