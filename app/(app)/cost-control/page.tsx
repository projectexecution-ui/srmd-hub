import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyUser } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Calculator, Plus, FileText, Clock, Inbox, Upload, ClipboardList, Settings, CalendarClock, ChevronDown, Download, RefreshCw, AlertTriangle, CheckCircle2, FileSpreadsheet, Ruler, ArrowRight } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { DeadlineBadge } from '@/components/cost-control/DeadlineBadge'
import { QueryError } from '@/components/ui/query-error'
import { wsStatusLabel, WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { plainStatusLabel, isPendingStatus } from '@/lib/cost-control/chain'
import { AutoBackup } from '@/components/cost-control/AutoBackup'
import { getLastBphSync } from '@/app/(app)/cost-control/import/bph/actions'
import { getCcSettings } from '@/lib/cost-control/settings'
import { getEffectiveCcRole } from '@/app/(app)/cost-control/billing/billing-actions'

export const dynamic = 'force-dynamic'

// Statuses that count as "waiting in the approval chain".
const PENDING_STATUSES = ['submitted', 'ph_approved', 'atm_approved', 'partially_approved']

type CCProject = {
  id: string
  code: string
  name: string
  cc_status: string | null
  setup_progress_pct: number | null
  built_up_sft: number | null
  parent_project_id: string | null
}

export default async function CostControlLandingPage() {
  const perms = await requirePermission('cost-control', 'view')
  const canWrite = can(perms, 'cost-control', 'edit')
  const canAdmin = can(perms, 'cost-control', 'admin')
  const supabase = await createClient()
  const user = await getMyUser()
  const ccSettings = await getCcSettings()

  // Management (approval-chain roles + admin) gets the full financial
  // dashboard. The Billing team lands straight on their IN4 queue.
  // Everyone else (engineers) gets a personal home with their OWN sheets
  // only — no project-level money anywhere in the payload.
  const isManagement = await checkIsCcReviewer()
  if (!isManagement) {
    if (ccSettings.billing_step && (await getEffectiveCcRole()) === 'billing') {
      redirect('/cost-control/billing')
    }
    return <EngineerHome userId={user?.id ?? null} canWrite={canWrite} />
  }

  const [projectsRes, wsAllRes, myDraftsRes, approversRes, deadlinesRes, budgetRes, backupRes] = await Promise.all([
    supabase
      .from('projects')
      .select('id, code, name, cc_status, setup_progress_pct, built_up_sft, parent_project_id')
      .not('cc_status', 'is', null)
      .order('code'),
    supabase.from('cc_working_sheets').select('id, status, total_amount, approved_for_erp_amt, project_id, discipline_id, deadline_date, in4_entered_at').is('archived_at', null),
    user
      ? supabase
          .from('cc_working_sheets')
          .select('id', { count: 'exact', head: true })
          .eq('engineer_id', user.id)
          .in('status', ['draft', 'returned'])
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

  const ccProjects = (projectsRes.data ?? []) as CCProject[]
  const incompleteCount = ccProjects.filter(p => (p.setup_progress_pct ?? 0) < 100).length

  type WSRollup = { id: string; status: string; total_amount: number | null; approved_for_erp_amt: number | null; project_id: string; discipline_id: string; deadline_date: string | null; in4_entered_at: string | null }
  const { data: wsData, error: wsErr } = wsAllRes
  const ws = (wsData ?? []) as WSRollup[]
  const todayStr = new Date().toISOString().slice(0, 10)
  const TERMINAL = new Set(['approved', 'wo_issued', 'paid', 'cancelled'])
  const APPROVED_DONE = new Set(['approved', 'wo_issued', 'paid'])

  // Money a sheet has actually had approved so far. Fully-approved sheets
  // fall back to total_amount when no ERP release figure was recorded;
  // partially-approved sheets count ONLY what has been released so far.
  const approvedSoFar = (w: WSRollup) => {
    const released = Number(w.approved_for_erp_amt ?? 0)
    if (APPROVED_DONE.has(w.status)) return released > 0 ? released : Number(w.total_amount ?? 0)
    if (w.status === 'partially_approved') return released
    return 0
  }

  // Per-project signals for the tiles.
  const wsByProject     = new Map<string, number>()   // total WS count
  const estimateByProj  = new Map<string, number>()   // live internal estimate (non-cancelled WS sum)
  const approvedByProj  = new Map<string, number>()   // approved-so-far money (incl. partial releases)
  const pendingByProj   = new Map<string, number>()   // WS awaiting approval
  const overdueByProj   = new Map<string, number>()   // open WS past deadline
  for (const w of ws) {
    wsByProject.set(w.project_id, (wsByProject.get(w.project_id) ?? 0) + 1)
    if (w.status !== 'cancelled') {
      estimateByProj.set(w.project_id, (estimateByProj.get(w.project_id) ?? 0) + Number(w.total_amount ?? 0))
    }
    const released = approvedSoFar(w)
    if (released > 0) {
      approvedByProj.set(w.project_id, (approvedByProj.get(w.project_id) ?? 0) + released)
    }
    if (PENDING_STATUSES.includes(w.status)) {
      pendingByProj.set(w.project_id, (pendingByProj.get(w.project_id) ?? 0) + 1)
    }
    if (w.deadline_date && w.deadline_date < todayStr && !TERMINAL.has(w.status)) {
      overdueByProj.set(w.project_id, (overdueByProj.get(w.project_id) ?? 0) + 1)
    }
  }

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

  const totalWS = ws.length
  const approvedTotal = ws.reduce((s, w) => s + approvedSoFar(w), 0)
  const myDrafts = myDraftsRes as { count?: number | null; error?: { message: string } | null }
  const draftsErr = myDrafts.error ?? null
  const myDraftsCount = myDrafts.count ?? 0

  // "Waiting on you" split for the pending stat. A sheet waits on the
  // current user when they actively approve its discipline, or always
  // when they are a Cost Control admin.
  const { data: approverData, error: approversErr } = approversRes
  const myDiscIds = new Set(((approverData ?? []) as Array<{ discipline_id: string }>).map(r => r.discipline_id))
  const pendingSheets = ws.filter(w => PENDING_STATUSES.includes(w.status))
  const pendingCount = pendingSheets.length
  const waitingOnMe = pendingSheets.filter(w => canAdmin || myDiscIds.has(w.discipline_id)).length
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

  // BPH auto-sync freshness — read-only, doesn't trigger a pull
  const bphSync = await getLastBphSync()

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
      lastBackup = dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    }
  }
  const lastBackupLine = backupErr
    ? "Last backup: couldn't check right now"
    : `Last backup: ${lastBackup ?? 'never yet'}`

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <AutoBackup isAdmin={canAdmin} />
      <PageHeader
        title="Cost Control"
        subtitle={`SRASSK — ${ccProjects.length} project${ccProjects.length === 1 ? '' : 's'}${incompleteCount ? ` · ${incompleteCount} need setup` : ''}`}
      >
        <details className="relative group [&_summary::-webkit-details-marker]:hidden">
          <summary className="list-none cursor-pointer inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 select-none">
            <Settings className="h-4 w-4" /> Tools
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="absolute right-0 top-[calc(100%+4px)] z-20 w-64 bg-white border border-gray-200 rounded-lg shadow-lg p-1.5">
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

      {/* BPH auto-sync freshness chip — only renders when at least one
          project is mapped. Otherwise a one-time CTA. */}
      <BphSyncChip sync={bphSync} canWrite={canWrite} />

      {/* Stat strip */}
      {wsErr || draftsErr ? (
        <QueryError message={(wsErr ?? draftsErr)?.message} what="the summary numbers" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <Stat label="Projects" value={ccProjects.length} hint={incompleteCount ? `${incompleteCount} need setup` : 'all set up'} icon={<Calculator className="h-5 w-5" />} />
          <Link href="/cost-control/approvals" className="block">
            <Stat
              label="Pending approvals"
              value={pendingCount}
              hint={
                pendingCount === 0
                  ? 'all clear'
                  : approversErr && !canAdmin
                    ? "couldn't check whose turn — open to review"
                    : `${waitingOnMe} waiting on you · ${withOthers} with others`
              }
              icon={<Inbox className="h-5 w-5" />}
              tone={pendingCount > 0 ? 'amber' : 'default'}
            />
          </Link>
          <Link
            href={user ? `/cost-control/working-sheets?engineer=${user.id}` : '/cost-control/working-sheets'}
            className="block"
          >
            <Stat label="Your drafts" value={myDraftsCount} hint="draft + returned to you" icon={<Clock className="h-5 w-5" />} />
          </Link>
          <Stat label="Approved value" value={formatINR(approvedTotal)} hint={`${totalWS} sheet${totalWS === 1 ? '' : 's'} total`} icon={<FileText className="h-5 w-5" />} />
          {ccSettings.billing_step && (() => {
            const queue = ws.filter(w =>
              (w.status === 'approved' || w.status === 'partially_approved')
              && Number(w.approved_for_erp_amt ?? 0) > 0
              && !w.in4_entered_at)
            if (queue.length === 0) return null
            return (
              <Link href="/cost-control/billing" className="block">
                <Stat
                  label="IN4 entry queue"
                  value={queue.length}
                  hint="released sheets awaiting IN4 entry by Billing"
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
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 min-w-[220px]">Project</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500">Status</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Area (sft)</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">WS</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Internal Estimate</th>
                  <th className="px-3 py-2.5 font-semibold text-[10px] uppercase tracking-wide text-gray-500 text-right">Approved via WS</th>
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
                {ccProjects.map(p => {
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
                      <td className="px-3 py-2.5">
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
                            <span className="inline-flex items-center text-[10px] font-bold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5" title={`${pending} working sheet${pending === 1 ? '' : 's'} awaiting approval`}>
                              {pending} pending
                            </span>
                          )}
                          {ccSettings.show_deadlines && overdue > 0 && (
                            <span className="inline-flex items-center text-[10px] font-bold text-rose-800 bg-rose-100 rounded-full px-2 py-0.5">
                              {overdue} overdue
                            </span>
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
              </tbody>
            </table>
          </div>
        </Card>
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

function BphSyncChip({
  sync,
  canWrite,
}: {
  sync: { ran_at: string | null; total_links: number; ok_count: number; err_count: number }
  canWrite: boolean
}) {
  // No mappings yet — show a one-time CTA so the PM discovers the BPH pull.
  if (sync.total_links === 0) {
    if (!canWrite) return null
    return (
      <Link
        href="/cost-control/import/bph"
        className="block rounded-lg border border-teal-200 bg-teal-50 px-4 py-2.5 hover:bg-teal-100 transition-colors"
      >
        <p className="text-sm font-semibold text-teal-900 inline-flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Connect your weekly BPH report
        </p>
        <p className="text-[11px] text-teal-800/80 mt-0.5">
          Pull budget data from your /budget upload into Cost Control. After a one-time mapping per project, it auto-syncs on every BPH upload.
        </p>
      </Link>
    )
  }

  const tone = sync.err_count > 0 ? 'amber' : 'emerald'
  const when = sync.ran_at
    ? new Date(sync.ran_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'never'

  return (
    <Link
      href="/cost-control/import/bph"
      className={`block rounded-lg border px-4 py-2 transition-colors ${
        tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50' : 'border-amber-200 bg-amber-50/60 hover:bg-amber-50'
      }`}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className={`text-xs font-semibold inline-flex items-center gap-1.5 ${
          tone === 'emerald' ? 'text-emerald-900' : 'text-amber-900'
        }`}>
          {tone === 'emerald' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
          BPH auto-sync · {sync.total_links} project{sync.total_links === 1 ? '' : 's'} mapped · last run {when}
        </p>
        {sync.err_count > 0 && (
          <span className="text-[11px] text-amber-800">
            {sync.err_count} mapping{sync.err_count === 1 ? '' : 's'} had errors — open to review
          </span>
        )}
      </div>
    </Link>
  )
}

// ─── Engineer personal home ─────────────────────────────────────────────
// Layman-friendly landing for non-management users: THEIR sheets, THEIR
// deadlines, big create buttons — and zero project-level financials.
async function EngineerHome({ userId, canWrite }: { userId: string | null; canWrite: boolean }) {
  const supabase = await createClient()

  type MyWS = {
    id: string
    ws_code: string
    status: string
    total_amount: number | null
    deadline_date: string | null
    return_reason: string | null
    created_at: string
    entry_mode: string | null
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    cc_disciplines: { code: string; name: string } | { code: string; name: string }[] | null
    cc_sub_skills: { code: string; name: string } | { code: string; name: string }[] | null
  }
  const { data: myData, error: myErr } = userId
    ? await supabase
        .from('cc_working_sheets')
        .select('id, ws_code, status, total_amount, deadline_date, return_reason, created_at, entry_mode, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
        .eq('engineer_id', userId)
        .is('archived_at', null)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [], error: null }
  const mine = (myData ?? []) as MyWS[]

  const needsMyAction = mine.filter(w => w.status === 'draft' || w.status === 'returned')
  const inApproval    = mine.filter(w => isPendingStatus(w.status))
  // Their own estimate value currently waiting in the approval chain.
  const inApprovalAmt = inApproval.reduce((s, w) => s + Number(w.total_amount ?? 0), 0)
  const done          = mine.filter(w => w.status === 'approved' || w.status === 'wo_issued' || w.status === 'paid')
  const todayStr = new Date().toISOString().slice(0, 10)
  const overdue = mine.filter(w =>
    w.deadline_date && w.deadline_date < todayStr &&
    !['approved', 'wo_issued', 'paid', 'cancelled'].includes(w.status)).length

  const pickOne = <T,>(x: T | T[] | null): T | undefined => (Array.isArray(x) ? x[0] : x) ?? undefined

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-r from-indigo-600 to-indigo-500 text-white px-5 py-6 md:px-7 shadow-sm">
        <h1 className="text-xl md:text-2xl font-bold">Cost Control — my work</h1>
        <p className="text-indigo-100 text-sm mt-1">
          Upload your working, send it for approval, and track where each sheet is in the chain.
        </p>
        {canWrite && (
          <div className="flex flex-wrap gap-2 mt-4">
            <Link href="/cost-control/working-sheets/new-quick"
              className="inline-flex items-center gap-2 rounded-xl bg-white text-indigo-800 font-semibold text-sm px-4 py-2.5 hover:bg-indigo-50 transition-colors shadow-sm">
              <FileSpreadsheet className="h-4 w-4" /> Upload my working (Excel)
            </Link>
            <Link href="/cost-control/working-sheets/new-thumbrule"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-700/60 border border-white/30 text-white font-semibold text-sm px-4 py-2.5 hover:bg-indigo-700 transition-colors">
              <Ruler className="h-4 w-4" /> Thumbrule estimate
            </Link>
            <Link href="/cost-control/working-sheets/new"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-700/60 border border-white/30 text-white font-semibold text-sm px-4 py-2.5 hover:bg-indigo-700 transition-colors">
              <Plus className="h-4 w-4" /> Type a sheet
            </Link>
          </div>
        )}
      </div>

      {/* My counters — counts only, no org money */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Needs my action" value={needsMyAction.length} hint="drafts + returned to me" icon={<Clock className="h-5 w-5" />} tone={needsMyAction.length > 0 ? 'amber' : 'default'} />
        <Stat label="Awaiting approval" value={inApproval.length} hint={inApprovalAmt > 0 ? `${formatINR(inApprovalAmt)} estimate in the chain` : 'moving through the chain'} icon={<Inbox className="h-5 w-5" />} />
        <Stat label="Approved" value={done.length} hint={overdue > 0 ? `${overdue} overdue deadline${overdue === 1 ? '' : 's'}` : 'all on time'} icon={<CheckCircle2 className="h-5 w-5" />} />
      </div>

      {myErr && <QueryError message={myErr.message} what="your working sheets" />}

      {/* My sheets */}
      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-900">My working sheets</h2>
          <Link href="/cost-control/working-sheets" className="text-xs font-semibold text-indigo-700 hover:underline inline-flex items-center gap-1">
            See all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        {mine.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No working sheets yet"
            description="Upload your first working — it goes to the Project Head, then the Atm Head, then the Trustee."
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {mine.slice(0, 15).map(w => {
              const proj = pickOne(w.projects)
              const dis  = pickOne(w.cc_disciplines)
              const sub  = pickOne(w.cc_sub_skills)
              return (
                <li key={w.id}>
                  <Link href={`/cost-control/working-sheets/${w.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-gray-900">{w.ws_code}</span>
                        <WSStatusPill status={w.status as WSStatus} />
                        {w.deadline_date && (
                          <DeadlineBadge deadlineDate={w.deadline_date} className="text-[10px] px-1.5 py-0.5"
                            approved={['approved', 'wo_issued', 'paid'].includes(w.status)} />
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">
                        {proj?.code ?? '—'} · {dis?.name ?? ''}{sub ? ` → ${sub.name}` : ''} · {formatDate(w.created_at)}
                      </p>
                      <p className="text-[11px] text-indigo-700 mt-0.5">{plainStatusLabel(w.status)}</p>
                      {w.status === 'returned' && w.return_reason && (
                        <p className="text-[11px] text-rose-700 mt-0.5 truncate" title={w.return_reason}>
                          Reason: {w.return_reason}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums whitespace-nowrap">
                      {formatINR(Number(w.total_amount ?? 0))}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
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
