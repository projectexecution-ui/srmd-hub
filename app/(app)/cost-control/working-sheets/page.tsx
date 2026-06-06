import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { DeadlineBadge } from '@/components/cost-control/DeadlineBadge'
import { FileText, Plus, FileSpreadsheet, Ruler } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const STATUS_FILTERS: Array<{ value: '' | WSStatus; label: string }> = [
  { value: '',                    label: 'All' },
  { value: 'draft',               label: 'Draft' },
  { value: 'submitted',           label: 'Submitted' },
  { value: 'partially_approved',  label: 'Partially approved' },
  { value: 'approved',            label: 'Approved' },
  { value: 'returned',            label: 'Returned' },
]

// Display order for the status-group sections in the list.
const STATUS_ORDER: WSStatus[] = [
  'submitted', 'partially_approved', 'returned', 'draft', 'draft_blocked',
  'approved', 'wo_issued', 'paid', 'cancelled',
]
const STATUS_GROUP_TITLES: Record<WSStatus, string> = {
  draft:              'Draft (in progress with engineer)',
  draft_blocked:      'Blocked drafts',
  submitted:          'Awaiting approval',
  partially_approved: 'Partially approved (awaiting more tranches)',
  approved:           'Fully approved',
  returned:           'Returned to engineer',
  wo_issued:          'WO issued',
  paid:               'Paid',
  cancelled:          'Cancelled',
}

export default async function WorkingSheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; status?: string; engineer?: string; discipline?: string; sub_skill?: string }>
}) {
  const perms = await requirePermission('cost-control', 'view')
  const canWrite = can(perms, 'cost-control', 'edit')
  const sp = await searchParams
  const supabase = await createClient()
  const scoped = !!sp.sub_skill

  let q = supabase
    .from('cc_working_sheets')
    .select('id, ws_code, status, total_amount, approved_for_erp_amt, created_at, deadline_date, engineer_id, project_id, sub_skill_id, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
    // Scoped view (single sub-skill) sorts oldest → newest so the cumulative
    // approved column reads left-to-right as a timeline. Default list still
    // newest-first.
    .order('created_at', { ascending: scoped })
    .limit(500)
  if (sp.project) q = q.eq('project_id', sp.project)
  if (sp.engineer) q = q.eq('engineer_id', sp.engineer)
  if (sp.discipline) q = q.eq('discipline_id', sp.discipline)
  if (sp.sub_skill) q = q.eq('sub_skill_id', sp.sub_skill)
  if (sp.status) q = q.eq('status', sp.status as WSStatus)

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
    sub_skill_id: string
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    cc_disciplines: { code: string; name: string } | { code: string; name: string }[] | null
    cc_sub_skills: { code: string; name: string } | { code: string; name: string }[] | null
  }
  const rows = (wsRes.data ?? []) as WSRow[]
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
    if (r.status === 'submitted' || r.status === 'partially_approved') {
      acc.pendingCount += 1
      acc.pendingAmount += Math.max(amt - appr, 0)
    }
    if (r.status === 'wo_issued' || r.status === 'paid' || r.status === 'approved') {
      acc.issuedReadyCount += 1
    }
    return acc
  }, { estimateTotal: 0, approvedToDate: 0, pendingCount: 0, pendingAmount: 0, issuedReadyCount: 0 })

  // Group rows by status for the rendered list.
  const groups = new Map<WSStatus, WSRow[]>()
  for (const r of rows) {
    const arr = groups.get(r.status) ?? []
    arr.push(r)
    groups.set(r.status, arr)
  }
  const orderedGroups = STATUS_ORDER
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

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Working Sheets"
        subtitle={`${rows.length} sheet${rows.length === 1 ? '' : 's'} · ${formatINR(total)}`}
        back="/cost-control"
      >
        {canWrite && (
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/cost-control/working-sheets/new-thumbrule">
                <Ruler className="h-4 w-4" /> Thumbrule
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/cost-control/working-sheets/new-quick">
                <FileSpreadsheet className="h-4 w-4" /> Quick mode (Excel)
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/cost-control/working-sheets/new">
                <Plus className="h-4 w-4" /> New Working Sheet
              </Link>
            </Button>
          </>
        )}
      </PageHeader>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {STATUS_FILTERS.map(opt => (
          <Link
            key={opt.value || 'all'}
            href={`/cost-control/working-sheets${buildQuery({ ...sp, status: opt.value || undefined })}`}
            className={
              'inline-flex items-center px-3 h-8 rounded-full text-xs font-semibold transition-colors ' +
              ((sp.status ?? '') === opt.value ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50')
            }
          >
            {opt.label}
          </Link>
        ))}
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
          <select
            name="engineer"
            defaultValue={sp.engineer ?? ''}
            className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700"
          >
            <option value="">All engineers</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.name ?? p.id}</option>)}
          </select>
          <button className="h-8 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700">
            Apply
          </button>
        </form>
      </div>

      {scoped && scopeLabels && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/60 px-3 py-2">
          <div className="text-xs text-blue-900">
            <span className="uppercase tracking-wide font-semibold text-[10px] text-blue-700 mr-2">Scoped to</span>
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
            className="text-[11px] font-semibold text-blue-700 hover:text-blue-900 underline-offset-2 hover:underline"
          >
            Clear scope
          </Link>
        </div>
      )}

      {/* KPI strip — running roll-up across the filtered set */}
      {rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KpiTile label="Estimate (total)"   value={formatINR(kpis.estimateTotal)}  sub={`${rows.length} sheet${rows.length === 1 ? '' : 's'}`} tone="indigo" />
          <KpiTile label="Approved to date"   value={formatINR(kpis.approvedToDate)} sub={kpis.estimateTotal > 0 ? `${Math.round((kpis.approvedToDate / kpis.estimateTotal) * 100)}% of estimate` : '—'} tone="green" />
          <KpiTile label="Pending approval"   value={formatINR(kpis.pendingAmount)}  sub={`${kpis.pendingCount} sheet${kpis.pendingCount === 1 ? '' : 's'} awaiting`} tone="amber" />
          <KpiTile label="Fully approved+"    value={String(kpis.issuedReadyCount)}  sub="approved / WO issued / paid" tone="blue" />
        </div>
      )}

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No Working Sheets match these filters"
            description="Create the first one with the button at the top right."
          />
        </Card>
      ) : scoped ? (
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
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Engineer</th>
                  <th className="px-4 py-2 font-semibold text-right">This WS estimate</th>
                  <th className="px-4 py-2 font-semibold text-right">This WS approved</th>
                  <th className="px-4 py-2 font-semibold text-right">Cumulative approved</th>
                  <th className="px-4 py-2 font-semibold text-right">% of running total</th>
                  <th className="px-4 py-2 font-semibold">Deadline</th>
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
                        <td className="px-4 py-2.5"><WSStatusPill status={w.status} /></td>
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
                      </tr>
                    )
                  })
                })()}
              </tbody>
              <tfoot className="bg-slate-50 border-t-2 border-gray-300">
                <tr>
                  <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold uppercase text-gray-600">Sub-skill totals</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">{formatINR(kpis.estimateTotal)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-emerald-800">{formatINR(kpis.approvedToDate)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-400">—</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-bold text-gray-900">
                    {kpis.estimateTotal > 0 ? `${Math.round((kpis.approvedToDate / kpis.estimateTotal) * 100)}%` : '—'}
                  </td>
                  <td className="px-4 py-2.5"></td>
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
            return (
              <Card key={g.status} className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <WSStatusPill status={g.status} />
                    <span className="text-sm font-semibold text-gray-900">{STATUS_GROUP_TITLES[g.status]}</span>
                    <span className="text-xs text-gray-500">· {g.rows.length}</span>
                  </div>
                  <div className="text-xs text-gray-600 tabular-nums text-right">
                    <span>{formatINR(sum)}</span>
                    {apprSum > 0 && apprSum < sum && (
                      <span className="ml-2 text-emerald-700">· {formatINR(apprSum)} approved</span>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-4 py-2 font-semibold">WS Code</th>
                        <th className="px-4 py-2 font-semibold">Project</th>
                        <th className="px-4 py-2 font-semibold">Discipline · Sub-skill</th>
                        <th className="px-4 py-2 font-semibold">Engineer</th>
                        <th className="px-4 py-2 font-semibold text-right">Estimate</th>
                        <th className="px-4 py-2 font-semibold text-right">Approved</th>
                        <th className="px-4 py-2 font-semibold">Deadline</th>
                        <th className="px-4 py-2 font-semibold">Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(w => {
                        const proj = Array.isArray(w.projects) ? w.projects[0] : w.projects
                        const dis = Array.isArray(w.cc_disciplines) ? w.cc_disciplines[0] : w.cc_disciplines
                        const sub = Array.isArray(w.cc_sub_skills) ? w.cc_sub_skills[0] : w.cc_sub_skills
                        const appr = Number(w.approved_for_erp_amt ?? 0)
                        const est = Number(w.total_amount ?? 0)
                        const pct = est > 0 ? Math.round((appr / est) * 100) : 0
                        return (
                          <tr key={w.id} className="border-t border-gray-100 hover:bg-gray-50">
                            <td className="px-4 py-2.5">
                              <Link href={`/cost-control/working-sheets/${w.id}`} className="font-semibold text-blue-700 hover:underline">
                                {w.ws_code}
                              </Link>
                            </td>
                            <td className="px-4 py-2.5 text-gray-700">{proj?.code ?? '—'}</td>
                            <td className="px-4 py-2.5 text-gray-700 truncate max-w-[260px]">
                              {dis?.code} · {sub?.name}
                            </td>
                            <td className="px-4 py-2.5 text-gray-700">{profileMap.get(w.engineer_id) ?? '—'}</td>
                            <td className="px-4 py-2.5 font-semibold text-gray-900 text-right tabular-nums">{formatINR(est)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {appr > 0 ? (
                                <span className={appr >= est ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                                  {formatINR(appr)}
                                  {appr < est && <span className="ml-1 text-[10px] text-amber-700/80">({pct}%)</span>}
                                </span>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
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
                            <td className="px-4 py-2.5 text-xs text-gray-500">{formatDate(w.created_at)}</td>
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
