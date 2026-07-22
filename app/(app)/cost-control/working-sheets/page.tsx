import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyUser } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { QueryError } from '@/components/ui/query-error'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { DeadlineBadge } from '@/components/cost-control/DeadlineBadge'
import { FileText, Plus, FileSpreadsheet, Ruler, GitBranch } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { getCcSettings } from '@/lib/cost-control/settings'

export const dynamic = 'force-dynamic'

const STATUS_FILTERS: Array<{ value: '' | WSStatus; label: string }> = [
  { value: '',                    label: 'All' },
  { value: 'draft',               label: 'Draft' },
  { value: 'submitted',           label: 'With Project Head' },
  { value: 'ph_approved',         label: 'With Atm Head' },
  { value: 'atm_approved',        label: 'With Trustee' },
  { value: 'partially_approved',  label: 'Partly released' },
  { value: 'approved',            label: 'Approved' },
  { value: 'returned',            label: 'Returned' },
]

// Display order for the status-group sections in the list.
const STATUS_ORDER: WSStatus[] = [
  'submitted', 'ph_approved', 'atm_approved', 'partially_approved', 'returned',
  'draft', 'draft_blocked', 'approved', 'wo_issued', 'paid', 'cancelled',
]
const STATUS_GROUP_TITLES: Record<WSStatus, string> = {
  draft:              'Draft (in progress with engineer)',
  draft_blocked:      'Blocked drafts',
  submitted:          'Waiting for the Project Head (stage 1 of 3)',
  ph_approved:        'Waiting for the Atm Head (stage 2 of 3)',
  atm_approved:       'Waiting for the Trustee (stage 3 of 3)',
  partially_approved: 'Partly released by the Trustee (awaiting more releases)',
  approved:           'Fully approved',
  returned:           'Returned to engineer',
  wo_issued:          'WO issued',
  paid:               'Paid',
  cancelled:          'Cancelled',
}

// Statuses that count as "waiting in the approval chain".
const PENDING: WSStatus[] = ['submitted', 'ph_approved', 'atm_approved', 'partially_approved']

// Which of the 3 approval steps a pending sheet has reached — drives the
// little ●●○ progress dots on each status band (Project Head → Atm Head →
// Trustee). Non-pending statuses aren't in the map (no dots shown).
const STAGE_OF: Partial<Record<WSStatus, number>> = {
  submitted: 1, ph_approved: 2, atm_approved: 3, partially_approved: 3,
}

export default async function WorkingSheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; status?: string; engineer?: string; discipline?: string; sub_skill?: string; auto?: string; dl?: string }>
}) {
  const perms = await requirePermission('cost-control', 'view')
  const canWrite = can(perms, 'cost-control', 'edit')
  const sp = await searchParams
  const supabase = await createClient()
  const cc = await getCcSettings()
  const showDeadlines = cc.show_deadlines
  const scoped = !!sp.sub_skill

  // Management (approval-chain roles + admin) sees everything. An engineer
  // sees only sheets they created + sheets in sub-skills assigned to them
  // for budget working — enforced below regardless of URL params.
  const [isManagement, me] = await Promise.all([checkIsCcReviewer(), getMyUser()])
  const canSeeOthers = isManagement

  // Virgin URL (no query params) → redirect to the user's most-recently-
  // touched project so they don't see a confusing cross-project mash-up.
  // After Apply (even with "All projects" picked) the URL carries empty
  // params, so this only fires on the very first land from a nav click.
  if (Object.keys(sp).length === 0) {
    let recentProjectId: string | null = null
    if (me) {
      // Their own most recent WS first
      const { data: mine } = await supabase
        .from('cc_working_sheets')
        .select('project_id')
        .eq('engineer_id', me.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      recentProjectId = (mine?.project_id as string | null) ?? null
      // Fallback for non-engineers (PMs, Heads) — most recent WS overall
      if (!recentProjectId) {
        const { data: any1 } = await supabase
          .from('cc_working_sheets')
          .select('project_id')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        recentProjectId = (any1?.project_id as string | null) ?? null
      }
    }
    if (recentProjectId) {
      // auto=1 lets the destination explain the silent project pick.
      redirect(`/cost-control/working-sheets?project=${recentProjectId}&auto=1`)
    }
    // No WSes exist anywhere → fall through and show empty state
  }

  // Query the versions VIEW (cc_ws_with_versions) instead of the base
  // table so every row carries chain_anchor_id + version_no + chain_size
  // without an N+1 in TypeScript.
  // "archived" is a pseudo-status: it filters on archived_at, not on the
  // real status column. Everywhere else archived sheets are hidden.
  const showArchived = sp.status === 'archived' && isManagement
  let q = supabase
    .from('cc_ws_with_versions')
    .select('id, ws_code, status, total_amount, approved_for_erp_amt, created_at, deadline_date, engineer_id, project_id, sub_skill_id, line_type, discipline_id, break_chain, chain_anchor_id, version_no, chain_size, source_excel_url, summary_notes, archived_at, archived_by, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
    .order('created_at', { ascending: scoped })
    .limit(500)
  if (sp.project) q = q.eq('project_id', sp.project)
  if (sp.engineer) q = q.eq('engineer_id', sp.engineer)
  if (sp.discipline) q = q.eq('discipline_id', sp.discipline)
  if (sp.sub_skill) q = q.eq('sub_skill_id', sp.sub_skill)
  if (showArchived) q = q.not('archived_at', 'is', null)
  else {
    q = q.is('archived_at', null)
    if (sp.status && sp.status !== 'archived') q = q.eq('status', sp.status as WSStatus)
  }
  // Engineer estimate visibility — enforced server-side regardless of the
  // URL's filter params. Admin picks the scope in Settings.
  // An engineer sees a sheet only if THEY created it, or the sub-skill is
  // assigned to them for budget working (cc_subskill_assignments). Never the
  // [IB…] Internal Estimate baseline. (engineer_id is not a safe [IB]
  // signal — the import attributed those to a real user — so the TS filter
  // below also drops them by the summary-notes tag.)
  let myAssignedPairs = new Set<string>()
  if (!isManagement && me) {
    const { data: ssa } = await supabase
      .from('cc_subskill_assignments')
      .select('project_id, sub_skill_id')
      .eq('engineer_id', me.id)
    const pairs = (ssa ?? []) as Array<{ project_id: string; sub_skill_id: string }>
    myAssignedPairs = new Set(pairs.map(a => `${a.project_id}::${a.sub_skill_id}`))
    const subIds = [...new Set(pairs.map(a => a.sub_skill_id))]
    if (subIds.length) {
      // Own sheets OR sheets in an assigned sub-skill; exact (project,
      // sub-skill) pairing is re-checked in TS below.
      q = q.or(`engineer_id.eq.${me.id},sub_skill_id.in.(${subIds.join(',')})`)
    } else {
      q = q.eq('engineer_id', me.id)
    }
  }

  const [wsRes, projectsRes, profilesRes] = await Promise.all([
    q,
    supabase.from('projects').select('id, code, name').not('cc_status', 'is', null).order('code'),
    supabase.from('profiles').select('id, full_name, name').eq('is_active', true),
  ])

  type WSRow = {
    id: string
    ws_code: string
    status: WSStatus
    total_amount: number | null
    approved_for_erp_amt: number | null
    created_at: string
    deadline_date: string | null
    engineer_id: string
    project_id: string
    discipline_id: string
    sub_skill_id: string
    line_type: 'work' | 'material' | 'combined'
    break_chain: boolean
    chain_anchor_id: string
    version_no: number
    chain_size: number
    source_excel_url: string | null
    summary_notes: string | null
    archived_at: string | null
    archived_by: string | null
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    cc_disciplines: { code: string; name: string } | { code: string; name: string }[] | null
    cc_sub_skills: { code: string; name: string } | { code: string; name: string }[] | null
  }
  const { data: wsData, error: wsError } = wsRes
  let rows = (wsData ?? []) as WSRow[]
  if (!isManagement) {
    // Defence in depth: an engineer only ever sees their OWN sheets or those
    // in a sub-skill assigned to them (exact project+sub-skill pair) — and
    // never an [IB…] baseline sheet, whatever the query returned.
    rows = rows.filter(r =>
      !(r.summary_notes ?? '').startsWith('[IB') &&
      (r.engineer_id === me?.id || myAssignedPairs.has(`${r.project_id}::${r.sub_skill_id}`)),
    )
  }
  const projects = projectsRes.data ?? []
  type ProfileLite = { id: string; full_name: string | null; name: string | null }
  const profiles = (profilesRes.data ?? []) as ProfileLite[]
  const profileMap = new Map(profiles.map(p => [p.id, p.full_name ?? p.name ?? '(unnamed)']))

  const total = rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0)

  // KPI roll-up across the filtered set.
  const kpis = rows.reduce((acc, r) => {
    const amt = Number(r.total_amount ?? 0)
    const appr = Number(r.approved_for_erp_amt ?? 0)
    if (r.status === 'cancelled') return acc
    acc.estimateTotal += amt
    acc.approvedToDate += appr
    if (PENDING.includes(r.status)) {
      acc.pendingCount += 1
      acc.pendingAmount += Math.max(amt - appr, 0)
    }
    if (r.status === 'wo_issued' || r.status === 'paid' || r.status === 'approved') {
      acc.issuedReadyCount += 1
    }
    return acc
  }, { estimateTotal: 0, approvedToDate: 0, pendingCount: 0, pendingAmount: 0, issuedReadyCount: 0 })

  // Group rows by status for the rendered list. Imported Internal Budget
  // sheets ([IB…]) are DB status 'draft' but aren't engineer drafts — pull
  // them into their own "Internal Estimate" group so they don't read as
  // work-in-progress. (Group key is a string to allow the pseudo-status.)
  const isEstimateRow = (r: WSRow) => (r.summary_notes ?? '').startsWith('[IB')
  const groups = new Map<string, WSRow[]>()
  for (const r of rows) {
    const key = isEstimateRow(r) ? 'estimate' : r.status
    const arr = groups.get(key) ?? []
    arr.push(r)
    groups.set(key, arr)
  }
  // Actionable statuses first; the imported baseline group sits at the end.
  const GROUP_ORDER: string[] = [...STATUS_ORDER, 'estimate']
  const orderedGroups = GROUP_ORDER
    .map(s => ({ status: s, rows: groups.get(s) ?? [] }))
    .filter(g => g.rows.length > 0)

  // Labels for the "scoped" banner. Prefer the joined data on the first row;
  // fall back to a small lookup when the scoped filter has zero matches.
  type LabelPair = { code: string; name: string } | undefined
  let scopeLabels: { project: LabelPair; discipline: LabelPair; subSkill: LabelPair } | null = null
  if (scoped) {
    if (rows.length > 0) {
      const r0 = rows[0]
      const pickOne = <T,>(x: T | T[] | null): T | undefined =>
        (Array.isArray(x) ? x[0] : x) ?? undefined
      scopeLabels = {
        project: pickOne(r0.projects),
        discipline: pickOne(r0.cc_disciplines),
        subSkill: pickOne(r0.cc_sub_skills),
      }
    } else {
      const [{ data: ss }, { data: dis }, { data: pr }] = await Promise.all([
        supabase.from('cc_sub_skills').select('code, name').eq('id', sp.sub_skill!).maybeSingle(),
        sp.discipline
          ? supabase.from('cc_disciplines').select('code, name').eq('id', sp.discipline).maybeSingle()
          : Promise.resolve({ data: null as { code: string; name: string } | null }),
        sp.project
          ? supabase.from('projects').select('code, name').eq('id', sp.project).maybeSingle()
          : Promise.resolve({ data: null as { code: string; name: string } | null }),
      ])
      scopeLabels = {
        project: pr ?? undefined,
        discipline: dis ?? undefined,
        subSkill: ss ?? undefined,
      }
    }
  }

  function buildQuery(params: Record<string, string | undefined>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    if (entries.length === 0) return ''
    return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`).join('&')
  }

  // Real filters only — keeps one-shot flags (auto, dl) out of the links the
  // filter chips and forms build, so notes/banners don't follow the user around.
  const filterParams = {
    project: sp.project,
    status: sp.status,
    engineer: sp.engineer,
    discipline: sp.discipline,
    sub_skill: sp.sub_skill,
  }
  const autoPickedProject =
    sp.auto === '1' && sp.project ? projects.find(p => p.id === sp.project) ?? null : null

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title={canSeeOthers ? 'Working Sheets' : 'My Working Sheets'}
        subtitle={canSeeOthers
          ? `${rows.length} sheet${rows.length === 1 ? '' : 's'} · ${formatINR(total)}`
          : `${rows.length} of your sheet${rows.length === 1 ? '' : 's'} · ${formatINR(total)}`}
        back={sp.project ? `/cost-control/projects/${sp.project}` : '/cost-control'}
      >
        {canWrite && (
          <>
            {/* Typed sheets + thumbrule are management-only; engineers must
                upload their working as Excel (the routes enforce this too). */}
            {isManagement && (
              <Button asChild size="sm" variant="outline">
                <Link href="/cost-control/working-sheets/new-thumbrule">
                  <Ruler className="h-4 w-4" /> Thumbrule
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant={isManagement ? 'outline' : 'default'}>
              <Link href="/cost-control/working-sheets/new-quick">
                <FileSpreadsheet className="h-4 w-4" /> {isManagement ? 'Quick mode (Excel)' : 'Upload my working (Excel)'}
              </Link>
            </Button>
            {isManagement && (
              <Button asChild size="sm">
                <Link href="/cost-control/working-sheets/new">
                  <Plus className="h-4 w-4" /> New Working Sheet
                </Link>
              </Button>
            )}
          </>
        )}
      </PageHeader>

      {sp.dl === 'failed' && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5">
          <p className="text-sm text-amber-900">
            Couldn&apos;t prepare the Excel download — the file may have been moved. Open the
            sheet and try again, or re-upload the Excel.
          </p>
          <Link
            href={`/cost-control/working-sheets${buildQuery({ ...filterParams, auto: sp.auto })}`}
            className="text-xs font-semibold text-amber-800 hover:text-amber-950 whitespace-nowrap underline-offset-2 hover:underline"
          >
            Dismiss
          </Link>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {STATUS_FILTERS.map(opt => (
          <Link
            key={opt.value || 'all'}
            href={`/cost-control/working-sheets${buildQuery({ ...filterParams, status: opt.value || undefined })}`}
            className={
              'inline-flex items-center px-3 h-8 rounded-full text-xs font-semibold transition-colors ' +
              ((sp.status ?? '') === opt.value ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50')
            }
          >
            {opt.label}
          </Link>
        ))}
        {isManagement && (
          <Link
            href={`/cost-control/working-sheets${buildQuery({ ...filterParams, status: 'archived' })}`}
            className={
              'inline-flex items-center px-3 h-8 rounded-full text-xs font-semibold transition-colors ' +
              (sp.status === 'archived' ? 'bg-gray-700 text-white' : 'bg-white border border-dashed border-gray-400 text-gray-500 hover:bg-gray-50')
            }
          >
            Archived
          </Link>
        )}
        <form action="/cost-control/working-sheets" method="get" className="ml-auto flex items-center gap-2 flex-wrap">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          {sp.discipline && <input type="hidden" name="discipline" value={sp.discipline} />}
          {sp.sub_skill && <input type="hidden" name="sub_skill" value={sp.sub_skill} />}
          <select
            name="project"
            defaultValue={sp.project ?? ''}
            className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700"
          >
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          {isManagement && (
            <select
              name="engineer"
              defaultValue={sp.engineer ?? ''}
              className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700"
            >
              <option value="">All engineers</option>
              {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.name ?? p.id}</option>)}
            </select>
          )}
          <button className="h-8 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700">
            Apply
          </button>
        </form>
      </div>

      {scoped && scopeLabels && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2">
          <div className="text-xs text-blue-900">
            <span className="uppercase tracking-wide font-semibold text-[10px] text-blue-700 mr-2">Showing only</span>
            {scopeLabels.project && (
              <span className="font-semibold">{scopeLabels.project.code}</span>
            )}
            {scopeLabels.discipline && (
              <>
                <span className="text-blue-400 mx-1.5">›</span>
                <span className="font-semibold">{scopeLabels.discipline.code}</span>
                <span className="text-blue-700"> {scopeLabels.discipline.name}</span>
              </>
            )}
            {scopeLabels.subSkill && (
              <>
                <span className="text-blue-400 mx-1.5">›</span>
                <span className="font-semibold">{scopeLabels.subSkill.code}</span>
                <span className="text-blue-700"> {scopeLabels.subSkill.name}</span>
              </>
            )}
          </div>
          <Link
            href={`/cost-control/working-sheets${buildQuery({ project: sp.project, status: sp.status, engineer: sp.engineer })}`}
            className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline-offset-2 hover:underline whitespace-nowrap"
          >
            Show all sheets
          </Link>
        </div>
      )}

      {autoPickedProject && (
        <p className="mb-3 text-xs text-gray-500">
          Showing <span className="font-semibold text-gray-700">{autoPickedProject.name}</span> — your
          most recent project. Pick another from the project filter.
        </p>
      )}

      {/* KPI strip — running roll-up across the filtered set. Shown to
          management, and to engineers only when the admin has widened their
          estimate visibility beyond their own sheets. */}
      {canSeeOthers && rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiTile label="Estimate (total)"   value={formatINR(kpis.estimateTotal)}  sub={`${rows.length} sheet${rows.length === 1 ? '' : 's'}`} tone="indigo" />
          <KpiTile label="Approved to date"   value={formatINR(kpis.approvedToDate)} sub={kpis.estimateTotal > 0 ? `${Math.round((kpis.approvedToDate / kpis.estimateTotal) * 100)}% of estimate` : '—'} tone="green" />
          <KpiTile label="Pending approval"   value={formatINR(kpis.pendingAmount)}  sub={`${kpis.pendingCount} sheet${kpis.pendingCount === 1 ? '' : 's'} awaiting`} tone="amber" />
          <KpiTile label="Fully approved+"    value={String(kpis.issuedReadyCount)}  sub="approved / WO issued / paid" tone="blue" />
        </div>
      )}

      {wsError ? (
        <QueryError message={wsError.message} what="working sheets" />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No Working Sheets match these filters"
            description={
              canWrite
                ? 'Clear the filters to see every sheet, or create a new one right here.'
                : 'Clear the filters to see every sheet.'
            }
            action={
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={`/cost-control/working-sheets${buildQuery({ project: sp.project })}`}
                  className="text-sm font-semibold text-blue-700 hover:underline"
                >
                  Clear filters
                </Link>
                {canWrite && (
                  <Button asChild size="sm">
                    <Link href={isManagement ? '/cost-control/working-sheets/new' : '/cost-control/working-sheets/new-quick'}>
                      <Plus className="h-4 w-4" /> {isManagement ? 'New Working Sheet' : 'Upload my working (Excel)'}
                    </Link>
                  </Button>
                )}
              </div>
            }
          />
        </Card>
      ) : scoped && isManagement ? (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-900">Approval timeline · oldest → newest</span>
            <div className="text-xs text-gray-600 tabular-nums">
              {formatINR(kpis.estimateTotal)} estimate · <span className="text-emerald-700 font-semibold">{formatINR(kpis.approvedToDate)}</span> approved
              {kpis.estimateTotal > 0 && (
                <span className="ml-1 text-gray-500">({Math.round((kpis.approvedToDate / kpis.estimateTotal) * 100)}%)</span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-semibold">Created</th>
                  <th className="px-4 py-2 font-semibold">WS Code</th>
                  <th className="px-3 py-2 font-semibold">Version</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Engineer</th>
                  <th className="px-4 py-2 font-semibold text-right">This WS estimate</th>
                  <th className="px-4 py-2 font-semibold text-right">This WS approved</th>
                  <th className="px-4 py-2 font-semibold text-right">Cumulative approved</th>
                  <th className="px-4 py-2 font-semibold text-right">% of running total</th>
                  {showDeadlines && <th className="px-4 py-2 font-semibold">Deadline</th>}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  // rows are already chronological (oldest → newest) when scoped.
                  let cumApproved = 0
                  let cumEstimate = 0
                  return rows.map(w => {
                    const est = Number(w.total_amount ?? 0)
                    const appr = Number(w.approved_for_erp_amt ?? 0)
                    cumApproved += appr
                    cumEstimate += est
                    const pct = cumEstimate > 0 ? Math.round((cumApproved / cumEstimate) * 100) : 0
                    return (
                      <tr key={w.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{formatDate(w.created_at)}</td>
                        <td className="px-4 py-2.5">
                          <Link href={`/cost-control/working-sheets/${w.id}`} className="font-semibold text-blue-700 hover:underline">
                            {w.ws_code}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <VersionBadge versionNo={w.version_no} chainSize={w.chain_size} breakChain={w.break_chain} />
                        </td>
                        <td className="px-4 py-2.5"><WSStatusPill status={w.status} estimateBaseline={(w.summary_notes ?? '').startsWith('[IB')} /></td>
                        <td className="px-4 py-2.5 text-gray-700">{profileMap.get(w.engineer_id) ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-900">{formatINR(est)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {appr > 0 ? (
                            <span className={appr >= est ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                              {formatINR(appr)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-emerald-800">{formatINR(cumApproved)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{pct}%</td>
                        {showDeadlines && (
                          <td className="px-4 py-2.5">
                            {w.deadline_date ? (
                              <DeadlineBadge
                                deadlineDate={w.deadline_date}
                                approved={w.status === 'approved' || w.status === 'wo_issued' || w.status === 'paid'}
                                className="text-xs px-2 py-1"
                              />
                            ) : (
                              <span className="text-xs text-gray-400">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })
                })()}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-gray-300">
                <tr>
                  <td colSpan={5} className="px-4 py-2.5 text-xs font-semibold uppercase text-gray-600">Sub-skill totals</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">{formatINR(kpis.estimateTotal)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-emerald-800">{formatINR(kpis.approvedToDate)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">—</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">
                    {kpis.estimateTotal > 0 ? `${Math.round((kpis.approvedToDate / kpis.estimateTotal) * 100)}%` : '—'}
                  </td>
                  {showDeadlines && <td className="px-4 py-2.5"></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {orderedGroups.map(g => {
            const sum = g.rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0)
            const apprSum = g.rows.reduce((s, r) => s + Number(r.approved_for_erp_amt ?? 0), 0)
            const isEstimate = g.status === 'estimate'
            const gStatus = g.status as WSStatus
            const stage = isEstimate ? undefined : STAGE_OF[gStatus]
            return (
              <Card key={g.status} className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 border-b border-gray-200">
                  <div className="flex items-center gap-2 flex-wrap">
                    <WSStatusPill status={isEstimate ? ('draft' as WSStatus) : gStatus} estimateBaseline={isEstimate} />
                    <span className="text-sm font-semibold text-gray-900">
                      {isEstimate ? 'Internal Estimate — imported baseline' : STATUS_GROUP_TITLES[gStatus]}
                    </span>
                    {/* ●●○ progress: which of Project Head → Atm Head → Trustee it's reached. */}
                    {stage && (
                      <span className="inline-flex items-center gap-1" title="Project Head → Atm Head → Trustee">
                        {[1, 2, 3].map(n => (
                          <span key={n} className={`h-1.5 w-1.5 rounded-full ${n <= (stage ?? 0) ? 'bg-indigo-600' : 'bg-gray-300'}`} />
                        ))}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">· {g.rows.length} sheet{g.rows.length === 1 ? '' : 's'}</span>
                  </div>
                  <div className="text-xs text-gray-600 tabular-nums text-right">
                    <span>{formatINR(sum)}{stage ? ' waiting' : isEstimate ? ' baseline' : ''}</span>
                    {apprSum > 0 && apprSum < sum && !isEstimate && (
                      <span className="ml-2 text-emerald-700">· {formatINR(apprSum)} released</span>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-2 font-semibold">Sheet</th>
                        <th className="px-4 py-2 font-semibold text-right">Estimate</th>
                        <th className="px-4 py-2 font-semibold text-right">Released</th>
                        {showDeadlines && <th className="px-4 py-2 font-semibold">Deadline</th>}
                        <th className="px-4 py-2 font-semibold">Raised</th>
                        <th className="px-4 py-2 font-semibold"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(w => {
                        const proj = Array.isArray(w.projects) ? w.projects[0] : w.projects
                        const sub = Array.isArray(w.cc_sub_skills) ? w.cc_sub_skills[0] : w.cc_sub_skills
                        const appr = Number(w.approved_for_erp_amt ?? 0)
                        const est = Number(w.total_amount ?? 0)
                        const pct = est > 0 ? Math.round((appr / est) * 100) : 0
                        const engName = profileMap.get(w.engineer_id)
                        const revLabel = (w.chain_size ?? 1) > 1 ? `Rev ${w.version_no} of ${w.chain_size}` : null
                        const href = `/cost-control/working-sheets/${w.id}`
                        return (
                          <tr key={w.id} className="border-t border-gray-100 hover:bg-gray-50">
                            {/* Headline = what the sheet is FOR; the code / revision /
                                project / engineer sit as muted context beneath. */}
                            <td className="px-4 py-2.5">
                              <Link href={href} className="group block">
                                <span className="font-semibold text-gray-900 group-hover:text-blue-700">
                                  {sub?.name ?? 'Working sheet'}
                                </span>
                                <span className="block text-[11px] text-gray-400 mt-0.5">
                                  <span className="font-mono">{w.ws_code}</span>
                                  {revLabel && <> · {revLabel}</>}
                                  {!scoped && proj?.code && <> · {proj.code}</>}
                                  {engName && <> · by {engName}</>}
                                </span>
                              </Link>
                              {(w.archived_at || w.source_excel_url) && (
                                <span className="inline-flex items-center gap-1.5 mt-1">
                                  {w.archived_at && (
                                    <span
                                      className="inline-flex items-center text-[10px] font-bold text-gray-600 bg-gray-100 border border-gray-300 rounded-full px-1.5 py-0.5"
                                      title={`Archived by ${profileMap.get(w.archived_by ?? '') ?? 'unknown'} on ${formatDate(w.archived_at)}`}
                                    >
                                      Archived · {profileMap.get(w.archived_by ?? '') ?? 'unknown'}
                                    </span>
                                  )}
                                  {w.source_excel_url && (
                                    <a
                                      href={`/api/cost-control/working-sheets/${w.id}/download`}
                                      className="inline-flex items-center gap-0.5 text-[10px] text-gray-400 hover:text-blue-700"
                                      title="Download the original uploaded Excel"
                                    >
                                      <FileSpreadsheet className="h-3 w-3" /> Excel
                                    </a>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 font-semibold text-gray-900 text-right tabular-nums">{formatINR(est)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {appr <= 0 ? (
                                <span className="text-xs text-gray-400">Not released yet</span>
                              ) : appr >= est ? (
                                <span className="text-emerald-700 font-semibold">{formatINR(appr)}</span>
                              ) : (
                                <span className="text-amber-700 font-semibold">
                                  {formatINR(appr)} <span className="text-[10px] font-normal">({pct}%)</span>
                                  <span className="block text-[10px] font-semibold text-rose-600/90 leading-tight">
                                    {formatINR(est - appr)} still to come
                                  </span>
                                </span>
                              )}
                            </td>
                            {showDeadlines && (
                              <td className="px-4 py-2.5">
                                {w.deadline_date ? (
                                  <DeadlineBadge
                                    deadlineDate={w.deadline_date}
                                    approved={w.status === 'approved' || w.status === 'wo_issued' || w.status === 'paid'}
                                    className="text-xs px-2 py-1"
                                  />
                                ) : (
                                  <span className="text-xs text-gray-400">—</span>
                                )}
                              </td>
                            )}
                            <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{formatDate(w.created_at)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <Link href={href} className="text-xs font-semibold text-blue-700 hover:underline whitespace-nowrap">
                                View →
                              </Link>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Compact version-chain marker shown next to each WS row. Always renders
 * so the engineer can tell whether their WS is the only one in its
 * bucket (v1/1, faint grey) or part of a chain (v2/3, bold blue).
 * A break_chain row gets a small fork icon to flag the explicit reset.
 */
function VersionBadge({
  versionNo,
  chainSize,
  breakChain,
  compact = false,
}: {
  versionNo: number
  chainSize: number
  breakChain: boolean
  compact?: boolean
}) {
  const lonely = chainSize === 1
  const tone = lonely ? 'text-gray-400 bg-gray-50 border-gray-200' : 'text-blue-800 bg-blue-50 border-blue-200'
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded ${compact ? 'text-[10px] px-1' : 'text-[11px] px-1.5 py-0.5'} font-mono border ${tone}`}
      title={lonely ? 'Only version in this bucket' : `Version ${versionNo} of ${chainSize}${breakChain ? ' · starts a new chain' : ''}`}
    >
      {breakChain && <GitBranch className="h-2.5 w-2.5" />}
      v{versionNo}/{chainSize}
    </span>
  )
}

function KpiTile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone: 'indigo' | 'green' | 'amber' | 'blue'
}) {
  const top = {
    indigo: 'border-t-indigo-500',
    green:  'border-t-emerald-500',
    amber:  'border-t-amber-500',
    blue:   'border-t-blue-500',
  }[tone]
  return (
    <div className={`bg-white rounded-md border border-gray-200 border-t-2 ${top} p-4`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}
