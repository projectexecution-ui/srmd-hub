import { Fragment } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyUser, getMyProfile } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Calculator, Plus, FileText, Clock, Inbox, Upload, ClipboardList, Settings, CalendarClock, ChevronDown, Download, RefreshCw, AlertTriangle, CheckCircle2, FileSpreadsheet, Ruler, ArrowRight, Bell } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { DeadlineBadge } from '@/components/cost-control/DeadlineBadge'
import { QueryError } from '@/components/ui/query-error'
import { wsStatusLabel, WSStatusPill } from '@/components/cost-control/WSStatusPill'
import { AutoBackup } from '@/components/cost-control/AutoBackup'
import { getLastBphSync } from '@/app/(app)/cost-control/import/bph/actions'
import { getCcSettings } from '@/lib/cost-control/settings'
import { getEffectiveCcRole } from '@/app/(app)/cost-control/billing/billing-actions'
import { GroupLabelChip } from './GroupLabelChip'
import { TreeProvider, TreeToolbar, CatChevron, CatRows } from '@/components/cost-control/project-tree'
import { CcQuickSearch } from './CcQuickSearch'
import { coveringApproverRole } from '@/lib/cost-control/approver-roles'
import { getModuleLabels, labelFor } from '@/lib/module-labels'

export const dynamic = 'force-dynamic'

// Statuses that count as "waiting in the approval chain".
const PENDING_STATUSES = ['submitted', 'ph_approved', 'atm_approved', 'partially_approved']

// The module's name comes from ONE source of truth — the editable module-label
// map (module_labels table, defaulting to lib/modules.ts). Rename it once on
// /admin/dashboard-modules and every surface follows: sidebar, tile, AND this
// page's title. Resolved per-request via getModuleLabels() below.

type CCProject = {
  id: string
  code: string
  name: string
  cc_status: string | null
  setup_progress_pct: number | null
  built_up_sft: number | null
  parent_project_id: string | null
  group_label: string | null
}

export default async function CostControlLandingPage() {
  const perms = await requirePermission('cost-control', 'view')
  const canWrite = can(perms, 'cost-control', 'edit')
  const canAdmin = can(perms, 'cost-control', 'admin')
  const supabase = await createClient()
  const user = await getMyUser()
  const ccSettings = await getCcSettings()
  // Renaming a group is admin-only (matches project rename/alias).
  const isAdmin = (await getMyProfile())?.role === 'admin'
  // Page title = the module's editable label (admin-renamable on
  // /admin/dashboard-modules), so it always matches the sidebar + tile.
  const ccLabel = labelFor(await getModuleLabels(), 'cost-control')

  // Management (approval-chain roles + admin) gets the full financial
  // dashboard. The Billing team lands straight on their IN4 queue.
  // Everyone else (engineers) gets a personal home with their OWN sheets
  // only — no project-level money anywhere in the payload.
  const isManagement = await checkIsCcReviewer()
  if (!isManagement) {
    if (ccSettings.billing_step && (await getEffectiveCcRole()) === 'billing') {
      redirect('/cost-control/billing')
    }
    return <EngineerHome userId={user?.id ?? null} canWrite={canWrite} label={ccLabel} />
  }

  const [projectsRes, wsAllRes, myDraftsRes, approversRes, deadlinesRes, budgetRes, backupRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, code, name, cc_status, setup_progress_pct, built_up_sft, parent_project_id, group_label')
      .not('cc_status', 'is', null)
      .is('archived_at', null)
      .order('code'),
    supabase.from('cc_working_sheets').select('id, status, total_amount, approved_for_erp_amt, project_id, discipline_id, deadline_date, in4_entered_at, summary_notes').is('archived_at', null),
    user
      ? supabase
          .from('cc_working_sheets')
          .select('id', { count: 'exact', head: true })
          .eq('engineer_id', user.id)
          .in('status', ['draft', 'returned'])
          // Exclude imported Internal Estimate baselines ([IB…]) — otherwise
          // whoever ran the import shows hundreds of "drafts" that aren't work.
          .not('summary_notes', 'ilike', '[IB%')
      : Promise.resolve({ count: 0, error: null }),
    // Disciplines the current user actively approves — powers the
    // "waiting on you" split on the pending stat (mirrors /approvals).
    user
      ? supabase
          .from('cc_discipline_approvers')
          .select('discipline_id')
          .eq('approver_user_id', user.id)
          .eq('is_active', true)
      : Promise.resolve({ data: [] as Array<{ discipline_id: string }>, error: null }),
    // Upcoming deadlines across all projects — open sheets only, soonest first.
    supabase
      .from('cc_working_sheets')
      .select('id, ws_code, status, total_amount, deadline_date, deadline_notes, project_id, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
      .not('deadline_date', 'is', null)
      .is('archived_at', null)
      .not('status', 'in', '(approved,wo_issued,paid,cancelled)')
      .order('deadline_date', { ascending: true })
      .limit(15),
    // Per-project budget rollup for the tiles (ERP budget / committed / paid).
    // discipline_id + sub_skill_id are needed for the summary-vs-detail dedup below.
    supabase.from('cc_budget_lines').select('project_id, discipline_id, sub_skill_id, current_budget_amt, current_wo_committed_amt, current_paid_amt'),
    supabase.from('app_settings').select('value').eq('key', 'cc_last_backup').maybeSingle(),
  ])

  // Version-chain identity for every live sheet (all projects). The base
  // table can't compute versions; only this view can. Used to collapse each
  // revision chain to its latest live version so money isn't counted twice.
  const verRes = await supabase
    .from('cc_ws_with_versions')
    .select('id, chain_anchor_id, version_no')
    .is('archived_at', null)

  // Projects/stages this user is a NAMED approver for (Phase 2). Combined with
  // discipline coverage below to decide what is "waiting on you" — kept in
  // step with the /approvals inbox so the bell count and that page agree.
  const { data: myPaRows } = user
    ? await supabase.from('cc_project_approvers').select('project_id, role').eq('user_id', user.id)
    : { data: [] as Array<{ project_id: string; role: string }> }
  const myCover = new Set((myPaRows ?? []).map(r => `${r.project_id}:${r.role}`))

  const ccProjects = (projectsRes.data ?? []) as CCProject[]
  const incompleteCount = ccProjects.filter(p => (p.setup_progress_pct ?? 0) < 100).length

  type WSRollup = { id: string; status: string; total_amount: number | null; approved_for_erp_amt: number | null; project_id: string; discipline_id: string; deadline_date: string | null; in4_entered_at: string | null; summary_notes: string | null }
  const { data: wsData, error: wsErr } = wsAllRes
  const ws = (wsData ?? []) as WSRollup[]
  const todayStr = new Date().toISOString().slice(0, 10)
  const TERMINAL = new Set(['approved', 'wo_issued', 'paid', 'cancelled'])
  const APPROVED_DONE = new Set(['approved', 'wo_issued', 'paid'])

  // Money a sheet has actually had approved so far. Fully-approved sheets
  // fall back to total_amount when no ERP release figure was recorded; any
  // other live sheet counts what has been released so far — released money
  // stays counted even while the sheet is back in the chain asking for its
  // balance (the release re-request flow).
  const approvedSoFar = (w: WSRollup) => {
    const released = Number(w.approved_for_erp_amt ?? 0)
    if (APPROVED_DONE.has(w.status)) return released > 0 ? released : Number(w.total_amount ?? 0)
    if (w.status === 'cancelled') return 0
    return released
  }

  // Collapse each revision chain to its latest live version, split into the
  // imported Internal Estimate baseline ([IB…]) and engineers' own sheets.
  // The two can share a chain (an engineer's ask is saved as a later
  // version of the sub-skill the [IB] baseline seeded), so keeping "latest
  // per chain" alone would drop the baseline. Baseline → estimate; engineer
  // sheets → approved / pending. Mirrors the project detail page exactly, so
  // the dashboard and the project page always show the same numbers.
  const chainOf = new Map<string, { anchor: string; ver: number }>()
  for (const r of (verRes.data ?? []) as { id: string; chain_anchor_id: string | null; version_no: number | null }[]) {
    if (r.chain_anchor_id) chainOf.set(r.id, { anchor: r.chain_anchor_id, ver: Number(r.version_no ?? 1) })
  }
  const latestIB  = new Map<string, { w: WSRollup; ver: number }>()
  const latestEng = new Map<string, { w: WSRollup; ver: number }>()
  for (const w of ws) {
    if (w.status === 'cancelled') continue
    const ch = chainOf.get(w.id) ?? { anchor: w.id, ver: 1 }
    const bag = (w.summary_notes ?? '').startsWith('[IB') ? latestIB : latestEng
    const prev = bag.get(ch.anchor)
    if (!prev || ch.ver > prev.ver) bag.set(ch.anchor, { w, ver: ch.ver })
  }
  const engWinners = [...latestEng.values()].map(x => x.w)

  // Per-project signals for the tiles.
  const wsChainsByProj  = new Map<string, Set<string>>() // distinct live chains
  const estimateByProj  = new Map<string, number>()   // Internal Estimate baseline (latest [IB] per chain)
  const approvedByProj  = new Map<string, number>()   // approved-so-far money (incl. partial releases)
  const pendingByProj   = new Map<string, number>()   // engineer sheets awaiting approval
  const overdueByProj   = new Map<string, number>()   // open sheets past deadline
  const addChain = (proj: string, anchor: string) => {
    const set = wsChainsByProj.get(proj) ?? new Set<string>()
    set.add(anchor); wsChainsByProj.set(proj, set)
  }
  const addOverdue = (w: WSRollup) => {
    if (w.deadline_date && w.deadline_date < todayStr && !TERMINAL.has(w.status)) {
      overdueByProj.set(w.project_id, (overdueByProj.get(w.project_id) ?? 0) + 1)
    }
  }
  for (const { w } of latestIB.values()) {
    addChain(w.project_id, chainOf.get(w.id)?.anchor ?? w.id)
    estimateByProj.set(w.project_id, (estimateByProj.get(w.project_id) ?? 0) + Number(w.total_amount ?? 0))
    addOverdue(w)
  }
  for (const w of engWinners) {
    addChain(w.project_id, chainOf.get(w.id)?.anchor ?? w.id)
    const released = approvedSoFar(w)
    if (released > 0) {
      approvedByProj.set(w.project_id, (approvedByProj.get(w.project_id) ?? 0) + released)
    }
    if (PENDING_STATUSES.includes(w.status)) {
      pendingByProj.set(w.project_id, (pendingByProj.get(w.project_id) ?? 0) + 1)
    }
    addOverdue(w)
  }
  // Distinct live chains per project (for the "N sheets" tile figure).
  const wsByProject = new Map<string, number>()
  for (const [proj, set] of wsChainsByProj) wsByProject.set(proj, set.size)

  // Per-project budget rollup (ERP budget / committed / paid).
  // Same rule as the project detail page: a BPH report often carries BOTH a
  // discipline summary row (sub_skill_id null) and its sub-skill detail rows;
  // the summary is the parent total of the details, so adding both doubles
  // the budget. Per (project, discipline): if any sub-skill line has money,
  // use only sub-skill lines; otherwise fall back to the root line.
  type BLRow = { project_id: string; discipline_id: string; sub_skill_id: string | null; current_budget_amt: number | null; current_wo_committed_amt: number | null; current_paid_amt: number | null }
  const { data: budgetData, error: budgetErr } = budgetRes
  const byProjDisc = new Map<string, { sub: BLRow[]; root: BLRow[] }>()
  for (const b of (budgetData ?? []) as BLRow[]) {
    const k = `${b.project_id}::${b.discipline_id}`
    const cur = byProjDisc.get(k) ?? { sub: [], root: [] }
    ;(b.sub_skill_id ? cur.sub : cur.root).push(b)
    byProjDisc.set(k, cur)
  }
  const budgetByProj = new Map<string, { budget: number; committed: number; paid: number }>()
  const addBudgetLine = (b: BLRow) => {
    const cur = budgetByProj.get(b.project_id) ?? { budget: 0, committed: 0, paid: 0 }
    cur.budget    += Number(b.current_budget_amt ?? 0)
    cur.committed += Number(b.current_wo_committed_amt ?? 0)
    cur.paid      += Number(b.current_paid_amt ?? 0)
    budgetByProj.set(b.project_id, cur)
  }
  for (const { sub, root } of byProjDisc.values()) {
    const hasSubMoney = sub.some(b =>
      Number(b.current_budget_amt ?? 0) !== 0 ||
      Number(b.current_wo_committed_amt ?? 0) !== 0 ||
      Number(b.current_paid_amt ?? 0) !== 0,
    )
    for (const b of sub) addBudgetLine(b)
    if (!hasSubMoney) for (const b of root) addBudgetLine(b)
  }

  // Distinct live chains across all projects (baseline + engineer, deduped).
  const totalWS = new Set<string>([...latestIB.keys(), ...latestEng.keys()]).size
  const approvedTotal = engWinners.reduce((s, w) => s + approvedSoFar(w), 0)
  const myDrafts = myDraftsRes as { count?: number | null; error?: { message: string } | null }
  const draftsErr = myDrafts.error ?? null
  const myDraftsCount = myDrafts.count ?? 0

  // "Waiting on you" split for the pending stat. A sheet waits on the
  // current user when they are the named approver for its current stage,
  // when they actively approve its discipline, or always when they are a
  // Cost Control admin. Same rule as the /approvals inbox.
  const { data: approverData, error: approversErr } = approversRes
  const myDiscIds = new Set(((approverData ?? []) as Array<{ discipline_id: string }>).map(r => r.discipline_id))
  const pendingSheets = engWinners.filter(w => PENDING_STATUSES.includes(w.status))
  const pendingCount = pendingSheets.length
  const coversStage = (w: WSRollup) =>
    myCover.has(`${w.project_id}:${coveringApproverRole(w.status) ?? ''}`)
  const waitingOnMe = pendingSheets.filter(w => canAdmin || myDiscIds.has(w.discipline_id) || coversStage(w)).length
  const withOthers = pendingCount - waitingOnMe

  type DeadlineRow = {
    id: string
    ws_code: string
    status: string
    total_amount: number | null
    deadline_date: string
    deadline_notes: string | null
    project_id: string
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    cc_disciplines: { code: string; name: string } | { code: string; name: string }[] | null
    cc_sub_skills: { code: string; name: string } | { code: string; name: string }[] | null
  }
  const { data: deadlineData, error: deadlinesErr } = deadlinesRes
  const upcomingDeadlines = (deadlineData ?? []) as DeadlineRow[]
  const overdueCount = upcomingDeadlines.filter(d => d.deadline_date < todayStr).length

  // BPH auto-sync freshness — read-only, doesn't trigger a pull. Only when the
  // BPH sync feature is switched on in Settings.
  const bphSync = ccSettings.bph_sync ? await getLastBphSync() : null

  // Last auto-backup marker for the Tools menu. Newer backups store a plain
  // ISO timestamp; older ones stored JSON {at: ...} — accept both.
  const { data: backupRow, error: backupErr } = backupRes
  let lastBackup: string | null = null
  const rawBackup = backupRow?.value ? String(backupRow.value) : null
  if (rawBackup) {
    let at: string | null = rawBackup
    try {
      const parsed = JSON.parse(rawBackup) as { at?: string } | string
      at = typeof parsed === 'string' ? parsed : parsed?.at ?? null
    } catch { /* plain ISO string — use as-is */ }
    const dt = at ? new Date(at) : null
    if (dt && !Number.isNaN(dt.getTime())) {
      lastBackup = dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    }
  }
  const lastBackupLine = backupErr
    ? "Last backup: couldn't check right now"
    : `Last backup: ${lastBackup ?? 'never yet'}`

  // ─── Group the projects table by parent project (NGH → NGH A/B/C,
  // P2 → P2 A01…, VV → VINAY/VIVEK) so the list reads group-wise. A parent
  // that is itself a project leads its group; projects with no parent and
  // no children collect under "Independent projects". Falls back to a flat
  // list when no groups exist.
  const projById = new Map(ccProjects.map(p => [p.id, p]))
  const childrenOf = new Map<string, CCProject[]>()
  for (const p of ccProjects) {
    if (p.parent_project_id && projById.has(p.parent_project_id)) {
      const arr = childrenOf.get(p.parent_project_id) ?? []
      arr.push(p)
      childrenOf.set(p.parent_project_id, arr)
    }
  }
  type ProjGroup = { key: string; label: string | null; members: CCProject[] }
  // A parent that carries NO cost-control data of its own (no budget, approved,
  // paid, estimate or working sheets) is a pure grouping ANCHOR — it exists only
  // to build the tree (NGH, P2, VV). We still show its group band + children,
  // but drop the parent's own empty row so the list isn't padded with a row of
  // dashes. A parent that DOES have its own budget/sheets still leads its group
  // as a real row. The parent stays reachable via the quick-search box.
  const parentHasOwnData = (p: CCProject): boolean => {
    const b = budgetByProj.get(p.id) ?? { budget: 0, committed: 0, paid: 0 }
    return b.budget > 0 || b.paid > 0 || b.committed > 0
      || (approvedByProj.get(p.id) ?? 0) > 0
      || (estimateByProj.get(p.id) ?? 0) > 0
      || (wsByProject.get(p.id) ?? 0) > 0
  }
  const projGroups: ProjGroup[] = []
  const independents: CCProject[] = []
  for (const p of ccProjects) {
    // Children render inside their parent's group, not at top level.
    if (p.parent_project_id && projById.has(p.parent_project_id)) continue
    const kids = (childrenOf.get(p.id) ?? []).slice().sort((a, b) => a.code.localeCompare(b.code))
    // Group heading = the admin's custom group name, else the parent's short
    // code (e.g. "NGH", "P2", "VV") — never the parent's full name, which can
    // carry extra words ("NGH Infra").
    if (kids.length > 0) {
      const members = parentHasOwnData(p) ? [p, ...kids] : kids
      projGroups.push({ key: p.id, label: p.group_label?.trim() || p.code.trim() || p.name.trim(), members })
    }
    else independents.push(p)
  }
  projGroups.sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''))
  if (independents.length > 0) {
    independents.sort((a, b) => a.code.localeCompare(b.code))
    // Only label the leftovers when there ARE real groups to separate from.
    projGroups.push({ key: '_independent', label: projGroups.length > 0 ? 'Independent projects' : null, members: independents })
  }
  // Rollup across a group's members for the header band.
  const groupTotals = (members: CCProject[]) => members.reduce((t, p) => {
    const bud = budgetByProj.get(p.id) ?? { budget: 0, committed: 0, paid: 0 }
    t.sft += Number(p.built_up_sft ?? 0)
    t.ws += wsByProject.get(p.id) ?? 0
    t.estimate += estimateByProj.get(p.id) ?? 0
    t.approved += approvedByProj.get(p.id) ?? 0
    t.budget += bud.budget
    t.paid += bud.paid
    return t
  }, { sft: 0, ws: 0, estimate: 0, approved: 0, budget: 0, paid: 0 })

  // Archived projects (soft-archived from a project's Settings). Hidden from the
  // active list above; only an admin sees the discovery list + can restore/delete.
  let archivedProjects: Array<{ id: string; code: string; name: string }> = []
  if (isAdmin) {
    const { data: arch } = await supabase
      .from('projects').select('id, code, name')
      .not('archived_at', 'is', null).order('code')
    archivedProjects = (arch ?? []) as Array<{ id: string; code: string; name: string }>
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <AutoBackup isAdmin={canAdmin} />
      {isAdmin && archivedProjects.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-amber-900 select-none">
            Archived projects ({archivedProjects.length})
          </summary>
          <p className="text-xs text-amber-800/80 mt-1 mb-2">Hidden from the active list. Open one to restore it or delete it permanently.</p>
          <ul className="space-y-1">
            {archivedProjects.map(ap => (
              <li key={ap.id}>
                <Link href={`/cost-control/projects/${ap.id}/setup`} className="text-sm text-blue-700 hover:underline">
                  {ap.code} · {ap.name}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
      <PageHeader
        title={ccLabel}
        subtitle={`SRASSK — ${ccProjects.length} project${ccProjects.length === 1 ? '' : 's'}${incompleteCount ? ` · ${incompleteCount} need setup` : ''}`}
      >
        <div className="hidden sm:block">
          <CcQuickSearch projects={ccProjects.map(p => ({ id: p.id, code: p.code, name: p.name, group: p.group_label }))} />
        </div>
        {/* Notification bell — how many budgets are waiting on this user right
            now. Links straight to the approvals inbox. Hidden when nothing is
            waiting so it never nags. */}
        {waitingOnMe > 0 && (
          <Link
            href="/cost-control/approvals"
            title={`${waitingOnMe} budget${waitingOnMe === 1 ? '' : 's'} waiting on you`}
            className="relative inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-rose-200 bg-rose-50 text-sm font-semibold text-rose-800 hover:bg-rose-100"
          >
            <Bell className="h-4 w-4" />
            <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold">{waitingOnMe}</span>
          </Link>
        )}
        {/* BPH auto-sync — compact icon; full status on hover. Hidden unless
            the feature is switched on in Settings. */}
        {bphSync && <BphSyncChip sync={bphSync} canWrite={canWrite} />}
        <details className="relative group [&_summary::-webkit-details-marker]:hidden">
          <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 select-none">
            <Settings className="h-4 w-4" /> Tools
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="absolute right-0 top-[calc(100%+4px)] z-20 w-64 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-lg shadow-lg p-1.5">
            {canWrite && (
              <Link href="/cost-control/import" className="flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-gray-50">
                <Upload className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">Import Excel budget</p>
                  <p className="text-[11px] text-gray-500">bulk-load ENGG report</p>
                </div>
              </Link>
            )}
            <Link href="/cost-control/audit" className="flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-gray-50">
              <ClipboardList className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">Audit log</p>
                <p className="text-[11px] text-gray-500">every edit & event</p>
              </div>
            </Link>
            {canAdmin && (
              <Link href="/cost-control/admin/disciplines" className="flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-gray-50">
                <Settings className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">Disciplines master</p>
                  <p className="text-[11px] text-gray-500">add / edit / archive disciplines + sub-skills</p>
                </div>
              </Link>
            )}
            {canAdmin && (
              <Link href="/cost-control/settings" className="flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-gray-50">
                <Settings className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">Settings</p>
                  <p className="text-[11px] text-gray-500">toggles for deadlines, ERP columns, AI, comments…</p>
                </div>
              </Link>
            )}
            {canAdmin && (
              <a href="/api/cost-control/backup" className="flex items-start gap-2.5 px-2.5 py-2 rounded-md hover:bg-gray-50 border-t border-gray-100 mt-1 pt-2">
                <Download className="h-4 w-4 text-gray-500 mt-0.5 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">Download full backup (Excel)</p>
                  <p className="text-[11px] text-gray-500">all Cost Control data · auto-saved daily</p>
                </div>
              </a>
            )}
            {canAdmin && (
              <div className="border-t border-gray-100 mt-1 px-2.5 py-1.5">
                <p className="text-[11px] text-gray-400">{lastBackupLine}</p>
              </div>
            )}
          </div>
        </details>
        <Button asChild size="sm" variant="outline">
          <Link href="/cost-control/working-sheets">
            <FileText className="h-4 w-4" /> All Working Sheets
          </Link>
        </Button>
        {canWrite && (
          <Button asChild size="sm">
            <Link href="/cost-control/projects/new"><Plus className="h-4 w-4" /> New Project</Link>
          </Button>
        )}
      </PageHeader>

      {/* Stat strip */}
      {wsErr || draftsErr ? (
        <QueryError message={(wsErr ?? draftsErr)?.message} what="the summary numbers" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Stat label="Projects" value={ccProjects.length} hint={incompleteCount ? `${incompleteCount} need setup` : 'all set up'} icon={<Calculator className="h-5 w-5" />} />
          <Link href="/cost-control/approvals" className="block">
            <Stat
              label="My Approvals"
              value={waitingOnMe}
              hint={
                approversErr && !canAdmin
                  ? "couldn't check whose turn — open to review"
                  : waitingOnMe === 0
                    ? (withOthers > 0 ? `all clear · ${withOthers} with the team` : 'all clear')
                    : (withOthers > 0 ? `waiting on you · ${withOthers} with the team` : 'all waiting on you')
              }
              icon={<Inbox className="h-5 w-5" />}
              tone={waitingOnMe > 0 ? 'amber' : 'default'}
            />
          </Link>
          <Link
            href={user ? `/cost-control/working-sheets?engineer=${user.id}` : '/cost-control/working-sheets'}
            className="block"
          >
            <Stat label="Your drafts" value={myDraftsCount} hint="draft + returned to you" icon={<Clock className="h-5 w-5" />} />
          </Link>
          <Stat label="Budget Approved in CT Hub" value={formatINR(approvedTotal)} hint={`approved through CT Hub's own chain · ${totalWS} sheet${totalWS === 1 ? '' : 's'}`} icon={<FileText className="h-5 w-5" />} />
          {ccSettings.billing_step && (() => {
            const queue = engWinners.filter(w =>
              (w.status === 'approved' || w.status === 'partially_approved')
              && Number(w.approved_for_erp_amt ?? 0) > 0
              && !w.in4_entered_at)
            if (queue.length === 0) return null
            return (
              <Link href="/cost-control/billing" className="block">
                <Stat
                  label="IN4 entry queue"
                  value={queue.length}
                  hint="released sheets awaiting IN4 entry"
                  icon={<ClipboardList className="h-5 w-5" />}
                  tone="amber"
                />
              </Link>
            )
          })()}
        </div>
      )}

      {/* Upcoming deadlines — cross-project summary (settings toggle) */}
      {ccSettings.show_deadlines && (deadlinesErr ? (
        <QueryError message={deadlinesErr.message} what="upcoming deadlines" />
      ) : upcomingDeadlines.length > 0 && (
        <Card className="p-4">
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-xs uppercase tracking-wide text-gray-500 font-semibold inline-flex items-center gap-1.5">
              <CalendarClock className="h-4 w-4 text-blue-600" />
              Upcoming deadlines
            </h3>
            <div className="flex items-center gap-2">
              {overdueCount > 0 && (
                <span className="text-[10px] font-bold text-rose-700 bg-rose-100 rounded-full px-2 py-0.5">
                  {overdueCount} overdue
                </span>
              )}
              <span className="text-[10px] text-gray-500">{upcomingDeadlines.length} open</span>
            </div>
          </div>
          <ul className="divide-y divide-gray-100">
            {upcomingDeadlines.map(d => {
              const proj = Array.isArray(d.projects) ? d.projects[0] : d.projects
              const dis  = Array.isArray(d.cc_disciplines) ? d.cc_disciplines[0] : d.cc_disciplines
              const sub  = Array.isArray(d.cc_sub_skills) ? d.cc_sub_skills[0] : d.cc_sub_skills
              return (
                <li key={d.id} className="py-2.5">
                  <Link href={`/cost-control/working-sheets/${d.id}`} className="flex items-center gap-3 hover:bg-gray-50 -mx-2 px-2 py-1 rounded">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-900 truncate">
                          {proj?.code ?? '—'}
                        </span>
                        <span className="text-xs text-gray-500 truncate">
                          {dis?.code} · {sub?.name}
                        </span>
                        <Badge variant="secondary" className="text-[10px]">{wsStatusLabel(d.status)}</Badge>
                      </div>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {d.ws_code}{d.deadline_notes ? ` · ${d.deadline_notes}` : ''}
                      </p>
                    </div>
                    <span className="text-xs text-gray-600 tabular-nums hidden md:inline">{formatINR(d.total_amount ?? 0)}</span>
                    <DeadlineBadge deadlineDate={d.deadline_date} className="text-[11px] px-2 py-0.5 flex-shrink-0" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
      ))}

      {projectsRes.error && (
        <Card className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Cost Control tables not yet applied to the database.</p>
          <p className="mt-1">Run the migrations in <code>supabase/migrations/20260523_cost_control_*.sql</code> first.</p>
        </Card>
      )}

      {/* Budget rollup failed — tiles below fall back to internal estimates,
          so say so instead of silently showing "no budget yet". */}
      {budgetErr && <QueryError message={budgetErr.message} what="the project budget totals" />}

      {ccProjects.length > 0 ? (
        // Tabular project overview — more data per glance than the old cards.
        // Client groups (NGH, P2, …) collapse into their roll-up like the
        // project detail tree.
        <TreeProvider
          allCatIds={projGroups.filter(g => g.label).map(g => g.key)}
          // Land on the roll-up, not 39 projects. Passing every group id as
          // "collapsed on first render" is the same declutter the project
          // detail tree uses; without it TreeProvider falls back to its legacy
          // all-expanded default.
          initialCollapsedIds={projGroups.filter(g => g.label).map(g => g.key)}
        >
        <Card className="overflow-hidden">
          {projGroups.some(g => g.label) && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60">
              <span className="text-[11px] font-medium text-gray-500">Projects grouped by client — click a group to collapse; totals roll up.</span>
              <TreeToolbar />
            </div>
          )}
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 min-w-[220px]">Project</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500">Status</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Area (sft)</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">WS</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Internal Estimate</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Budget Approved in CT Hub</th>
                  {ccSettings.show_erp_columns && (
                    <>
                      <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Budget (ERP)</th>
                      <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Paid</th>
                      <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">% Used</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {projGroups.map(g => {
                  const gt = groupTotals(g.members)
                  const gPaidPct = gt.budget > 0 ? Math.round((gt.paid / gt.budget) * 100) : 0
                  return (
                  <Fragment key={g.key}>
                    {/* Group band — name + rollup of the whole group. */}
                    {g.label && (
                      <tr className="bg-indigo-50/80 border-t border-indigo-100">
                        <td className="px-3 py-2 font-bold text-[11px] uppercase tracking-wide text-indigo-900" colSpan={2}>
                          <CatChevron catId={g.key} />
                          {g.key !== '_independent'
                            ? <GroupLabelChip projectId={g.key} label={g.label ?? ''} isAdmin={isAdmin} />
                            : g.label}
                          <span className="ml-2 font-normal normal-case text-indigo-400">{g.members.length} project{g.members.length === 1 ? '' : 's'}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[11px] font-semibold text-indigo-900/70">
                          {gt.sft > 0 ? gt.sft.toLocaleString('en-IN') : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[11px] font-semibold text-indigo-900/70">{gt.ws || '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[11px] font-bold text-indigo-900">
                          {gt.estimate > 0 ? formatINR(gt.estimate) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[11px] font-bold text-emerald-800">
                          {gt.approved > 0 ? formatINR(gt.approved) : '—'}
                        </td>
                        {ccSettings.show_erp_columns && (
                          <>
                            <td className="px-3 py-2 text-right tabular-nums text-[11px] font-bold text-indigo-900">
                              {gt.budget > 0 ? formatINR(gt.budget) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[11px] font-semibold text-indigo-900/70">
                              {gt.paid > 0 ? formatINR(gt.paid) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-[11px] font-bold text-indigo-900/70">
                              {gt.budget > 0 ? `${gPaidPct}%` : '—'}
                            </td>
                          </>
                        )}
                      </tr>
                    )}
                    <CatRows catId={g.key}>
                    {g.members.map(p => {
                  const pct = p.setup_progress_pct ?? 0
                  const isIncomplete = pct < 100
                  const wsHere = wsByProject.get(p.id) ?? 0
                  const bud = budgetByProj.get(p.id) ?? { budget: 0, committed: 0, paid: 0 }
                  const estimate = estimateByProj.get(p.id) ?? 0
                  const approvedHere = approvedByProj.get(p.id) ?? 0
                  const pending = pendingByProj.get(p.id) ?? 0
                  const overdue = overdueByProj.get(p.id) ?? 0
                  const paidPct = bud.budget > 0 ? Math.round((bud.paid / bud.budget) * 100) : 0
                  const hot = paidPct > 95
                  return (
                    <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50/70">
                      <td className={`px-3 py-2.5 ${g.label ? 'pl-8' : ''}`}>
                        <Link href={`/cost-control/projects/${p.id}`} className="block">
                          <span className="font-mono text-[11px] font-bold text-indigo-700 mr-2">{p.code}</span>
                          <span className="font-semibold text-gray-900 hover:underline">{p.name}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          {isIncomplete ? (
                            <span className="inline-flex items-center text-[10px] font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">
                              Setup {pct}%
                            </span>
                          ) : (
                            p.cc_status && (
                              <Badge variant={p.cc_status === 'active' ? 'success' : 'secondary'}>
                                {p.cc_status.replace('_', ' ')}
                              </Badge>
                            )
                          )}
                          {pending > 0 && (
                            <Link
                              href={`/cost-control/working-sheets?project=${p.id}`}
                              className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-full px-2 py-0.5 transition-colors"
                              title={`${pending} working sheet${pending === 1 ? '' : 's'} awaiting approval — click to review`}
                            >
                              {pending} pending →
                            </Link>
                          )}
                          {ccSettings.show_deadlines && overdue > 0 && (
                            <Link
                              href={`/cost-control/working-sheets?project=${p.id}`}
                              className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-800 bg-rose-100 hover:bg-rose-200 rounded-full px-2 py-0.5 transition-colors"
                              title={`${overdue} sheet${overdue === 1 ? '' : 's'} past deadline — click to review`}
                            >
                              {overdue} overdue →
                            </Link>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                        {p.built_up_sft != null ? p.built_up_sft.toLocaleString('en-IN') : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{wsHere || '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-indigo-800">
                        {estimate > 0 ? formatINR(estimate) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 font-semibold">
                        {approvedHere > 0 ? formatINR(approvedHere) : '—'}
                      </td>
                      {ccSettings.show_erp_columns && (
                        <>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">
                            {bud.budget > 0 ? formatINR(bud.budget) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">
                            {bud.paid > 0 ? formatINR(bud.paid) : '—'}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums font-semibold ${hot ? 'text-rose-600' : paidPct > 80 ? 'text-amber-700' : paidPct > 0 ? 'text-green-700' : 'text-gray-400'}`}>
                            {bud.budget > 0 ? `${paidPct}%` : '—'}
                          </td>
                        </>
                      )}
                    </tr>
                  )
                    })}
                    </CatRows>
                  </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: projects as cards — the table is too wide for a phone. */}
          <div className="md:hidden divide-y divide-gray-100">
            {projGroups.map(g => {
              const gt = groupTotals(g.members)
              return (
                <div key={g.key}>
                  {g.label && (
                    <div className="flex items-center justify-between gap-2 px-4 py-2 bg-indigo-50/80">
                      <span className="flex items-center min-w-0 text-[12px] font-bold uppercase tracking-wide text-indigo-900">
                        <CatChevron catId={g.key} />
                        <span className="truncate">{g.label}</span>
                        <span className="ml-1.5 font-normal normal-case text-indigo-400 whitespace-nowrap">· {g.members.length}</span>
                      </span>
                      <p className="text-[11px] text-indigo-900/70 flex-shrink-0 whitespace-nowrap">
                        Est <span className="font-semibold">{gt.estimate > 0 ? formatINR(gt.estimate) : '—'}</span>
                        <span className="mx-1">·</span>
                        Appr <span className="font-semibold text-emerald-800">{gt.approved > 0 ? formatINR(gt.approved) : '—'}</span>
                      </p>
                    </div>
                  )}
                  <CatRows catId={g.key}>
                  {g.members.map(p => {
                    const pct = p.setup_progress_pct ?? 0
                    const isIncomplete = pct < 100
                    const wsHere = wsByProject.get(p.id) ?? 0
                    const bud = budgetByProj.get(p.id) ?? { budget: 0, committed: 0, paid: 0 }
                    const estimate = estimateByProj.get(p.id) ?? 0
                    const approvedHere = approvedByProj.get(p.id) ?? 0
                    const pending = pendingByProj.get(p.id) ?? 0
                    const overdue = overdueByProj.get(p.id) ?? 0
                    return (
                      <div key={p.id} className="px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <Link href={`/cost-control/projects/${p.id}`} className="min-w-0">
                            <span className="font-mono text-[11px] font-bold text-indigo-700 mr-1.5">{p.code}</span>
                            <span className="font-semibold text-gray-900">{p.name}</span>
                          </Link>
                          <span className="flex-shrink-0 text-[11px] text-gray-400 whitespace-nowrap">
                            {wsHere || 0} WS{p.built_up_sft != null ? ` · ${p.built_up_sft.toLocaleString('en-IN')} sft` : ''}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {isIncomplete
                            ? <span className="text-[10px] font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">Setup {pct}%</span>
                            : p.cc_status && <Badge variant={p.cc_status === 'active' ? 'success' : 'secondary'}>{p.cc_status.replace('_', ' ')}</Badge>}
                          {pending > 0 && <Link href={`/cost-control/working-sheets?project=${p.id}`} className="text-[10px] font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5">{pending} pending →</Link>}
                          {ccSettings.show_deadlines && overdue > 0 && <Link href={`/cost-control/working-sheets?project=${p.id}`} className="text-[10px] font-bold text-rose-800 bg-rose-100 rounded-full px-2 py-0.5">{overdue} overdue →</Link>}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                          <div className="rounded-lg bg-indigo-50/60 py-1.5">
                            <p className="text-[10px] uppercase tracking-wide text-gray-500">Internal Estimate</p>
                            <p className="text-[13px] font-semibold text-indigo-800 tabular-nums">{estimate > 0 ? formatINR(estimate) : '—'}</p>
                          </div>
                          <div className="rounded-lg bg-emerald-50/60 py-1.5">
                            <p className="text-[10px] uppercase tracking-wide text-gray-500">Budget Approved in CT Hub</p>
                            <p className="text-[13px] font-semibold text-emerald-700 tabular-nums">{approvedHere > 0 ? formatINR(approvedHere) : '—'}</p>
                          </div>
                        </div>
                        {ccSettings.show_erp_columns && (bud.budget > 0 || bud.paid > 0) && (
                          <p className="mt-1.5 text-[11px] text-gray-500">Budget {bud.budget > 0 ? formatINR(bud.budget) : '—'} · Paid {bud.paid > 0 ? formatINR(bud.paid) : '—'}</p>
                        )}
                      </div>
                    )
                  })}
                  </CatRows>
                </div>
              )
            })}
          </div>
        </Card>
        </TreeProvider>
      ) : (
        <Card>
          <EmptyState
            icon={<Calculator className="h-10 w-10" />}
            title="No Cost Control projects yet"
            description="Start a new project to track Working Sheets, budgets, and approvals."
            action={canWrite ? <Button asChild size="sm"><Link href="/cost-control/projects/new">Create first project</Link></Button> : null}
          />
        </Card>
      )}
    </div>
  )
}

// Compact BPH auto-sync indicator for the dashboard header. A single icon
// button; the full status ("N projects mapped · last run …") is the hover
// tooltip. Green when healthy, amber when a mapping errored, teal CTA when
// nothing is mapped yet.
function BphSyncChip({
  sync,
  canWrite,
}: {
  sync: { ran_at: string | null; total_links: number; ok_count: number; err_count: number }
  canWrite: boolean
}) {
  // No mappings yet — a discreet "connect BPH" icon (writers only).
  if (sync.total_links === 0) {
    if (!canWrite) return null
    return (
      <Link
        href="/cost-control/import/bph"
        title="Connect your weekly BPH report — pull budget data into Cost Control. After a one-time mapping per project, it auto-syncs on every upload."
        className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100"
      >
        <RefreshCw className="h-4 w-4" />
      </Link>
    )
  }

  const healthy = sync.err_count === 0
  const when = sync.ran_at
    ? new Date(sync.ran_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    : 'never'
  // The BPH report is a WEEKLY manual export from IN4 (no auto-fetch is
  // possible), so the real risk is forgetting to upload it and letting the ERP
  // figures go silently stale. Past a week, turn the quiet line into an amber,
  // one-tap "upload this week's report" nudge (writers only) that links
  // straight to the Budget upload page.
  const STALE_DAYS = 7
  const ageDays = sync.ran_at
    ? Math.floor((Date.now() - Date.parse(sync.ran_at)) / 86_400_000)
    : Infinity

  if (healthy) {
    if (canWrite && ageDays >= STALE_DAYS) {
      return (
        <Link
          href="/budget"
          title={`Cost Control's ERP figures last refreshed ${when} — ${ageDays} days ago. Export this week's BPH report from IN4 and upload it on the Budget page; all ${sync.total_links} mapped projects then re-sync automatically.`}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-amber-300 bg-amber-50 text-sm font-semibold text-amber-800 hover:bg-amber-100 whitespace-nowrap"
        >
          <RefreshCw className="h-4 w-4" />
          BPH {ageDays}d old<span className="hidden sm:inline"> — upload this week&apos;s</span>
        </Link>
      )
    }
    // Fresh → a VERY quiet grey line ("BPH synced · <when>"): low-key
    // reassurance that the ERP figures auto-sync (twice a day + on every
    // upload) without drawing the eye. Errors stay amber with a count.
    return (
      <Link
        href="/cost-control/import/bph"
        title={`BPH reports auto-synced · ${sync.total_links} project${sync.total_links === 1 ? '' : 's'} mapped · last run ${when} · refreshes twice a day and on every upload`}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600 whitespace-nowrap"
      >
        <CheckCircle2 className="h-3 w-3 text-emerald-400" />
        BPH synced<span className="hidden md:inline text-gray-300"> · {when}</span>
      </Link>
    )
  }
  return (
    <Link
      href="/cost-control/import/bph"
      title={`BPH auto-sync · ${sync.total_links} mapped · last run ${when} · ${sync.err_count} mapping${sync.err_count === 1 ? '' : 's'} had errors — open to review`}
      className="relative inline-flex items-center justify-center h-9 w-9 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
    >
      <AlertTriangle className="h-4 w-4" />
      <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full bg-amber-500 text-white text-[9px] font-bold">{sync.err_count}</span>
    </Link>
  )
}

// ─── Engineer home ──────────────────────────────────────────────────────
// The engineer landing mirrors the management project page — every Category
// and Sub-skill, with Awaiting Approval / Budget (ERP) / WO / Working Sheets
// — but NEVER the Internal Estimate, Paid, or % Used. Their assigned work is
// pinned at the TOP (it's the first thing they need to act on); every project
// they're on is stacked below — no switcher — so they take it all in on one
// scrolling screen.
async function EngineerHome({ userId, canWrite, label }: { userId: string | null; canWrite: boolean; label: string }) {
  const supabase = await createClient()

  // The engineer's own working sheets — used to show how many sheets they
  // have per project ("My work" column).
  type MyWsRow = {
    id: string; ws_code: string; project_id: string; sub_skill_id: string; status: string
    return_reason: string | null; created_at: string
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    cc_sub_skills: { name: string } | { name: string }[] | null
  }
  const myWsRes = userId
    ? await supabase.from('cc_working_sheets')
        .select('id, ws_code, project_id, sub_skill_id, status, return_reason, created_at, projects(code, name), cc_sub_skills(name)')
        .eq('engineer_id', userId).is('archived_at', null).neq('status', 'cancelled')
        .order('created_at', { ascending: false })
    : { data: [] as MyWsRow[] }
  const myWs = (myWsRes.data ?? []) as MyWsRow[]

  type EProj = { id: string; code: string; name: string; built_up_sft: number | null; parent_project_id: string | null; group_label: string | null }
  // Role-based access: an engineer can raise a budget in ANY cost-control
  // project, so the home lists them all — not just projects they're assigned
  // to or already have a sheet in.
  const { data: projData, error: projErr } = await supabase
    .from('projects')
    .select('id, code, name, built_up_sft, parent_project_id, group_label')
    .not('cc_status', 'is', null)
    .order('code')
  const projects = (projData ?? []) as EProj[]
  const projIds = new Set<string>(projects.map(p => p.id))

  // Per-project ERP budget (Budget + WO) for the project cards. Same
  // summary-vs-detail dedup as management: per (project, discipline), if any
  // sub-skill line carries money use those and ignore the discipline root
  // line; else fall back to the root. Paid is never fetched (hidden from
  // engineers).
  type BLRow = { project_id: string; discipline_id: string; sub_skill_id: string | null; current_budget_amt: number | null; current_wo_committed_amt: number | null }
  const { data: blData } = projIds.size
    ? await supabase.from('cc_budget_lines').select('project_id, discipline_id, sub_skill_id, current_budget_amt, current_wo_committed_amt').in('project_id', [...projIds])
    : { data: [] as BLRow[] }
  const byProjDisc = new Map<string, { sub: BLRow[]; root: BLRow[] }>()
  for (const b of (blData ?? []) as BLRow[]) {
    const k = `${b.project_id}::${b.discipline_id}`
    const cur = byProjDisc.get(k) ?? { sub: [], root: [] }
    ;(b.sub_skill_id ? cur.sub : cur.root).push(b)
    byProjDisc.set(k, cur)
  }
  const budgetByProj = new Map<string, { budget: number; wo: number }>()
  const blMoney = (b: BLRow) => Number(b.current_budget_amt ?? 0) || Number(b.current_wo_committed_amt ?? 0)
  for (const { sub, root } of byProjDisc.values()) {
    const rows = sub.some(blMoney) ? sub : root
    for (const b of rows) {
      const cur = budgetByProj.get(b.project_id) ?? { budget: 0, wo: 0 }
      cur.budget += Number(b.current_budget_amt ?? 0)
      cur.wo += Number(b.current_wo_committed_amt ?? 0)
      budgetByProj.set(b.project_id, cur)
    }
  }

  // Per-project: how many of my own sheets sit in the project, split by where
  // each one stands so the engineer is kept updated on their requests:
  //   approved  = money moving (approved / partly released / WO / paid)
  //   awaiting  = still in the approval chain (submitted → PH → Atm → Trustee)
  //   returned  = sent back to me for changes (needs action)
  //   draft     = raised but not yet sent for approval
  type WStat = { approved: number; awaiting: number; returned: number; draft: number }
  const emptyStat = (): WStat => ({ approved: 0, awaiting: 0, returned: 0, draft: 0 })
  const AWAITING_ST = new Set(['submitted', 'ph_approved', 'atm_approved'])
  const APPROVED_ST = new Set(['approved', 'partially_approved', 'wo_issued', 'paid'])
  const bucketStatus = (into: WStat, status: string) => {
    if (status === 'returned') into.returned++
    else if (status === 'draft') into.draft++
    else if (AWAITING_ST.has(status)) into.awaiting++
    else if (APPROVED_ST.has(status)) into.approved++
  }
  const mySheetsByProj = new Map<string, number>()
  const statusByProj = new Map<string, WStat>()
  for (const w of myWs) {
    mySheetsByProj.set(w.project_id, (mySheetsByProj.get(w.project_id) ?? 0) + 1)
    const c = statusByProj.get(w.project_id) ?? emptyStat()
    bucketStatus(c, w.status)
    statusByProj.set(w.project_id, c)
  }

  // "My Work" action strip + attention lists — the engineer's own queue.
  const pickOne = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
  const draftSheets = myWs.filter(w => w.status === 'draft')
  const returnedSheets = myWs.filter(w => w.status === 'returned')
  const myAwaitingCount = myWs.filter(w => AWAITING_ST.has(w.status)).length
  const myApprovedCount = myWs.filter(w => APPROVED_ST.has(w.status)).length
  const workStat = (label: string, count: number, cls: string) => (
    <Link href="/cost-control/working-sheets" className={`rounded-xl border p-3 hover:shadow-sm transition-shadow ${cls}`}>
      <p className="text-2xl font-bold tabular-nums leading-none">{count}</p>
      <p className="text-[11px] font-medium mt-1">{label}</p>
    </Link>
  )

  // Status chips for the "My work" column — shows only the non-zero buckets so
  // the engineer sees at a glance what's approved vs still awaiting. Reused for
  // a single project row and a group's rolled-up total.
  const workChips = (st: WStat) => {
    const total = st.approved + st.awaiting + st.returned + st.draft
    if (total === 0) return <span className="text-[11px] text-gray-400">—</span>
    const chip = (n: number, label: string, cls: string) =>
      n > 0 ? <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${cls}`}>{n} {label}</span> : null
    return (
      <div className="flex flex-wrap items-center gap-1">
        {chip(st.approved, 'approved', 'bg-emerald-50 text-emerald-700 border-emerald-200')}
        {chip(st.awaiting, 'awaiting', 'bg-amber-50 text-amber-700 border-amber-200')}
        {chip(st.returned, 'returned', 'bg-rose-50 text-rose-700 border-rose-200')}
        {chip(st.draft, 'draft', 'bg-gray-100 text-gray-600 border-gray-200')}
      </div>
    )
  }

  // Group my projects by parent (mirrors the management dashboard). A parent
  // I'm not assigned to still labels the band — fetch those labels too.
  const projByIdE = new Map(projects.map(p => [p.id, p]))
  const parentIds = [...new Set(projects.map(p => p.parent_project_id).filter((x): x is string => !!x && !projByIdE.has(x)))]
  const { data: parentData } = parentIds.length
    ? await supabase.from('projects').select('id, code, name, group_label').in('id', parentIds)
    : { data: [] as Array<{ id: string; code: string; name: string; group_label: string | null }> }
  const parentLabelById = new Map<string, { code: string; name: string; group_label: string | null }>()
  for (const p of (parentData ?? [])) parentLabelById.set(p.id, { code: p.code, name: p.name, group_label: p.group_label })

  const parentHasKids = new Set<string>()
  for (const p of projects) if (p.parent_project_id) parentHasKids.add(p.parent_project_id)
  const groupKeyOf = (p: EProj): string =>
    p.parent_project_id ? p.parent_project_id : parentHasKids.has(p.id) ? p.id : `solo:${p.id}`
  const groupLabelFor = (key: string): string => {
    const inSet = projByIdE.get(key)
    if (inSet) return inSet.group_label?.trim() || inSet.code.trim() || inSet.name.trim()
    const par = parentLabelById.get(key)
    return par ? (par.group_label?.trim() || par.code.trim() || par.name.trim()) : ''
  }
  const groupMap = new Map<string, EProj[]>()
  for (const p of projects) {
    const k = groupKeyOf(p)
    const arr = groupMap.get(k) ?? []
    arr.push(p)
    groupMap.set(k, arr)
  }
  type EGroup = { key: string; label: string; members: EProj[] }
  const realGroups: EGroup[] = []
  const soloProjects: EProj[] = []
  for (const [k, members] of groupMap) {
    if (k.startsWith('solo:')) { soloProjects.push(...members); continue }
    members.sort((a, b) => (a.id === k ? -1 : b.id === k ? 1 : a.code.localeCompare(b.code)))
    realGroups.push({ key: k, label: groupLabelFor(k), members })
  }
  realGroups.sort((a, b) => a.label.localeCompare(b.label))
  soloProjects.sort((a, b) => a.code.localeCompare(b.code))

  // One project row — reused for grouped members + independents.
  const renderProjRow = (p: EProj, indent: boolean) => {
    const bud = budgetByProj.get(p.id)
    const sheets = mySheetsByProj.get(p.id) ?? 0
    const sft = Number(p.built_up_sft ?? 0)
    return (
      <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50/70">
        <td className={`px-3 py-2.5 ${indent ? 'pl-8' : ''}`}>
          <Link href={`/cost-control/projects/${p.id}`} className="block">
            <span className="font-mono text-[11px] font-bold text-indigo-700 mr-2">{p.code}</span>
            <span className="font-semibold text-gray-900 hover:underline">{p.name}</span>
          </Link>
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{sft > 0 ? sft.toLocaleString('en-IN') : '—'}</td>
        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-900">{bud?.budget ? formatINR(bud.budget) : '—'}</td>
        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{bud?.wo ? formatINR(bud.wo) : '—'}</td>
        <td className="px-3 py-2.5">
          {sheets > 0 ? workChips(statusByProj.get(p.id) ?? emptyStat()) : <span className="text-[11px] text-gray-400">—</span>}
        </td>
      </tr>
    )
  }

  // Mobile card for one project (the table is too wide for a phone).
  const renderProjCard = (p: EProj) => {
    const bud = budgetByProj.get(p.id)
    const sheets = mySheetsByProj.get(p.id) ?? 0
    const sft = Number(p.built_up_sft ?? 0)
    return (
      <div key={p.id} className="px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/cost-control/projects/${p.id}`} className="min-w-0">
            <span className="font-mono text-[11px] font-bold text-indigo-700 mr-1.5">{p.code}</span>
            <span className="font-semibold text-gray-900">{p.name}</span>
          </Link>
          {sft > 0 && <span className="flex-shrink-0 text-[11px] text-gray-400 whitespace-nowrap">{sft.toLocaleString('en-IN')} sft</span>}
        </div>
        <div className="mt-2">
          {sheets > 0 ? workChips(statusByProj.get(p.id) ?? emptyStat()) : <span className="text-[11px] text-gray-400">No requests yet</span>}
        </div>
        {(bud?.budget || bud?.wo) && (
          <p className="mt-1.5 text-[11px] text-gray-500">Budget {bud?.budget ? formatINR(bud.budget) : '—'} · WO {bud?.wo ? formatINR(bud.wo) : '—'}</p>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title={label}
        subtitle="Your projects' budget and the estimates moving through approval."
      >
        {canWrite && (
          <Button asChild size="sm">
            <Link href="/cost-control/working-sheets/new-quick">
              <FileSpreadsheet className="h-4 w-4" /> Raise Budget Request
            </Link>
          </Button>
        )}
        <Button asChild size="sm" variant="outline">
          <Link href="/cost-control/working-sheets">
            <FileText className="h-4 w-4" /> My working sheets
          </Link>
        </Button>
      </PageHeader>

      {/* My Work — the engineer's own queue at a glance (clickable). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {workStat('Drafts', draftSheets.length, 'border-gray-200 bg-white text-gray-700')}
        {workStat('Awaiting approval', myAwaitingCount, 'border-amber-200 bg-amber-50 text-amber-800')}
        {workStat('Returned to you', returnedSheets.length, 'border-rose-200 bg-rose-50 text-rose-800')}
        {workStat('Approved', myApprovedCount, 'border-emerald-200 bg-emerald-50 text-emerald-800')}
      </div>

      {/* Needs your attention — returns to fix + drafts to finish. */}
      {(returnedSheets.length > 0 || draftSheets.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {returnedSheets.length > 0 && (
            <Card className="p-0 overflow-hidden border-rose-200">
              <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-100">
                <h2 className="text-sm font-semibold text-rose-900">Returned to you — needs changes</h2>
                <p className="text-xs text-rose-700/80 mt-0.5">Fix what the approver flagged, then send again.</p>
              </div>
              <div className="divide-y divide-gray-100">
                {returnedSheets.map(w => {
                  const sub = pickOne(w.cc_sub_skills); const proj = pickOne(w.projects)
                  return (
                    <Link key={w.id} href={`/cost-control/working-sheets/${w.id}`} className="block px-4 py-2.5 hover:bg-gray-50">
                      <p className="text-sm font-medium text-gray-900">{sub?.name ?? w.ws_code} <span className="text-xs font-normal text-gray-400">{proj?.code}</span></p>
                      {w.return_reason && <p className="text-xs text-rose-700 mt-0.5 line-clamp-2">&ldquo;{w.return_reason}&rdquo;</p>}
                      <span className="text-[11px] font-semibold text-rose-700">Fix &amp; resend →</span>
                    </Link>
                  )
                })}
              </div>
            </Card>
          )}
          {draftSheets.length > 0 && (
            <Card className="p-0 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">Drafts — not sent yet</h2>
                <p className="text-xs text-gray-500 mt-0.5">Finish these and send them for approval.</p>
              </div>
              <div className="divide-y divide-gray-100">
                {draftSheets.map(w => {
                  const sub = pickOne(w.cc_sub_skills); const proj = pickOne(w.projects)
                  return (
                    <Link key={w.id} href={`/cost-control/working-sheets/${w.id}`} className="block px-4 py-2.5 hover:bg-gray-50">
                      <p className="text-sm font-medium text-gray-900">{sub?.name ?? w.ws_code} <span className="text-xs font-normal text-gray-400">{proj?.code}</span></p>
                      <span className="text-[11px] font-semibold text-blue-700">Finish &amp; send →</span>
                    </Link>
                  )
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {projects.length === 0 ? (
        <Card>
          {projErr ? (
            <QueryError message={projErr.message} what="your Cost Control projects" />
          ) : (
            <EmptyState
              icon={<Calculator className="h-10 w-10" />}
              title="No projects yet"
              description="No Cost Control projects have been set up yet — once a project is created it shows up here to open."
            />
          )}
        </Card>
      ) : (
        <TreeProvider
          allCatIds={[...realGroups.map(g => g.key), ...(realGroups.length > 0 && soloProjects.length > 0 ? ['_independent'] : [])]}
          initialCollapsedIds={[...realGroups.map(g => g.key), ...(realGroups.length > 0 && soloProjects.length > 0 ? ['_independent'] : [])]}
        >
        <Card className="overflow-hidden">
          {realGroups.length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60">
              <span className="text-[11px] font-medium text-gray-500">Grouped by client — click a group to collapse.</span>
              <TreeToolbar />
            </div>
          )}
          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 min-w-[220px]">Project</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Area (sft)</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Budget (ERP)</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">WO / PO</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 w-28">My work</th>
                </tr>
              </thead>
              <tbody>
                {realGroups.map(g => {
                  const gt = g.members.reduce((t, p) => {
                    const bud = budgetByProj.get(p.id)
                    t.sft += Number(p.built_up_sft ?? 0)
                    t.budget += bud?.budget ?? 0
                    t.wo += bud?.wo ?? 0
                    const s = statusByProj.get(p.id)
                    if (s) { t.st.approved += s.approved; t.st.awaiting += s.awaiting; t.st.returned += s.returned; t.st.draft += s.draft }
                    return t
                  }, { sft: 0, budget: 0, wo: 0, st: emptyStat() })
                  return (
                    <Fragment key={g.key}>
                      <tr className="bg-indigo-50/80 border-t border-indigo-100">
                        <td className="px-3 py-2 font-bold text-[11px] uppercase tracking-wide text-indigo-900">
                          <CatChevron catId={g.key} />
                          {g.label}
                          <span className="ml-2 font-normal normal-case text-indigo-400">{g.members.length} project{g.members.length === 1 ? '' : 's'}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-[11px] font-semibold text-indigo-900/70">{gt.sft > 0 ? gt.sft.toLocaleString('en-IN') : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[11px] font-bold text-indigo-900">{gt.budget > 0 ? formatINR(gt.budget) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[11px] font-semibold text-indigo-900/70">{gt.wo > 0 ? formatINR(gt.wo) : '—'}</td>
                        <td className="px-3 py-2">{workChips(gt.st)}</td>
                      </tr>
                      <CatRows catId={g.key}>{g.members.map(p => renderProjRow(p, true))}</CatRows>
                    </Fragment>
                  )
                })}
                {soloProjects.length > 0 && (
                  <Fragment key="_independent">
                    {realGroups.length > 0 && (
                      <tr className="bg-gray-50 border-t border-gray-200">
                        <td className="px-3 py-2 font-bold text-[11px] uppercase tracking-wide text-gray-500" colSpan={5}>
                          <CatChevron catId="_independent" />
                          Independent projects
                          <span className="ml-2 font-normal normal-case text-gray-400">{soloProjects.length} project{soloProjects.length === 1 ? '' : 's'}</span>
                        </td>
                      </tr>
                    )}
                    {realGroups.length > 0 ? (
                      <CatRows catId="_independent">{soloProjects.map(p => renderProjRow(p, false))}</CatRows>
                    ) : (
                      soloProjects.map(p => renderProjRow(p, false))
                    )}
                  </Fragment>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile: my projects as cards with request-status chips. */}
          <div className="md:hidden divide-y divide-gray-100">
            {realGroups.map(g => {
              const gt = g.members.reduce((t, p) => {
                const s = statusByProj.get(p.id)
                if (s) { t.approved += s.approved; t.awaiting += s.awaiting; t.returned += s.returned; t.draft += s.draft }
                return t
              }, emptyStat())
              return (
                <div key={g.key}>
                  <div className="flex items-center justify-between gap-2 px-4 py-2 bg-indigo-50/80">
                    <span className="flex items-center min-w-0 text-[12px] font-bold uppercase tracking-wide text-indigo-900">
                      <CatChevron catId={g.key} />
                      <span className="truncate">{g.label}</span>
                      <span className="ml-1.5 font-normal normal-case text-indigo-400 whitespace-nowrap">· {g.members.length}</span>
                    </span>
                    <div className="flex-shrink-0">{workChips(gt)}</div>
                  </div>
                  <CatRows catId={g.key}>{g.members.map(renderProjCard)}</CatRows>
                </div>
              )
            })}
            {soloProjects.length > 0 && (
              <div>
                {realGroups.length > 0 && (
                  <p className="px-4 py-2 bg-gray-50 text-[12px] font-bold uppercase tracking-wide text-gray-500 flex items-center"><CatChevron catId="_independent" />Independent projects</p>
                )}
                <CatRows catId="_independent">{soloProjects.map(renderProjCard)}</CatRows>
              </div>
            )}
          </div>
        </Card>
        </TreeProvider>
      )}
    </div>
  )

}

function Stat({ label, value, hint, icon, tone = 'default' }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode; tone?: 'default' | 'amber' }) {
  const wrap = tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'
  const iconWrap = tone === 'amber' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-700'
  return (
    <div className={`rounded-xl border ${wrap} p-4`}>
      <div className="flex items-center gap-3">
        {icon && <div className={`p-2 rounded-lg ${iconWrap}`}>{icon}</div>}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
          {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
        </div>
      </div>
    </div>
  )
}
