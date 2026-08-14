import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { isWaitingOnMe, type MyApprovalContext } from '@/lib/cost-control/my-approvals'
import { getCcSettings } from '@/lib/cost-control/settings'
import { computeMoneyRollup, type RollupWSRow, type RollupVersionRow } from '@/lib/cost-control/project-rollup'
import { formatINR } from '@/lib/utils'
import { Inbox, ArrowRight, Ruler, ArrowUpRight, ArrowDownRight, Download } from 'lucide-react'

// Whole days a sheet has been waiting since it was submitted.
function daysWaiting(submittedAt: string | null): number {
  if (!submittedAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(submittedAt).getTime()) / 86400000))
}

export const dynamic = 'force-dynamic'

interface PRow { code: string; name: string; built_up_sft: number | null }
interface DRow { code: string; name: string }
interface SRow { code: string; name: string }

interface WSRow {
  id: string
  ws_code: string
  status: string
  total_amount: number
  approved_for_erp_amt: number | null
  submitted_at: string | null
  engineer_id: string
  discipline_id: string
  sub_skill_id: string | null
  project_id: string
  chain_anchor_id: string | null
  version_no: number | null
  projects: PRow | PRow[] | null
  cc_disciplines: DRow | DRow[] | null
  cc_sub_skills: SRow | SRow[] | null
}

interface BudgetLineRow {
  project_id: string
  discipline_id: string | null
  sub_skill_id: string | null
  current_budget_amt: number | null
  current_wo_committed_amt: number | null
  current_paid_amt: number | null
}

// A live working sheet used to compute "approved so far" — the money rollup
// needs both the sheet fields (RollupWSRow) and its version-chain fields
// (RollupVersionRow), plus the project it belongs to.
interface RollupSheetRow extends RollupWSRow, RollupVersionRow { project_id: string }

// The full-picture extras shown per sheet on the approval card: ₹/sft on the
// estimate, the ERP Budget·WO·Paid strip for this sheet's (discipline,
// sub-skill), and how this ask compares to the previous revision. All optional
// — each piece hides itself when the data or the setting toggle isn't there.
interface WSEnrichment {
  perSftEst: string | null
  erp: {
    budget: number; wo: number; paid: number
    budgetPerSft: string | null; paidPerSft: string | null
    woPct: number | null; paidPct: number | null
  } | null
  // ERP columns are on, but this sheet's (project, discipline, sub-skill) has no
  // BPH-synced budget line yet → this ask would be a brand-new ERP budget.
  erpNew: boolean
  prev: { total: number; ver: number; deltaPct: number | null } | null
}

function pickFirst<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

// Soft, distinct colour per project so a long list of approvals reads as
// clearly separate projects. Assigned by a stable hash of the project code, so
// a project keeps the same colour on every visit.
const TONES = [
  { rail: 'border-l-indigo-300', head: 'bg-indigo-50/70', code: 'bg-indigo-100 text-indigo-700', avatar: 'bg-indigo-100 text-indigo-700', ba: 'bg-indigo-50/60 border-indigo-200 text-indigo-900' },
  { rail: 'border-l-teal-300',   head: 'bg-teal-50/70',   code: 'bg-teal-100 text-teal-700',     avatar: 'bg-teal-100 text-teal-700',     ba: 'bg-teal-50/60 border-teal-200 text-teal-900' },
  { rail: 'border-l-violet-300', head: 'bg-violet-50/70', code: 'bg-violet-100 text-violet-700', avatar: 'bg-violet-100 text-violet-700', ba: 'bg-violet-50/60 border-violet-200 text-violet-900' },
  { rail: 'border-l-rose-300',   head: 'bg-rose-50/70',   code: 'bg-rose-100 text-rose-700',     avatar: 'bg-rose-100 text-rose-700',     ba: 'bg-rose-50/60 border-rose-200 text-rose-900' },
  { rail: 'border-l-sky-300',    head: 'bg-sky-50/70',    code: 'bg-sky-100 text-sky-700',       avatar: 'bg-sky-100 text-sky-700',       ba: 'bg-sky-50/60 border-sky-200 text-sky-900' },
  { rail: 'border-l-amber-300',  head: 'bg-amber-50/70',  code: 'bg-amber-100 text-amber-700',   avatar: 'bg-amber-100 text-amber-700',   ba: 'bg-amber-50/60 border-amber-200 text-amber-900' },
]
function toneFor(key: string) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return TONES[h % TONES.length]
}

export default async function ApprovalsInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>
}) {
  await requirePermission('cost-control', 'view')
  // Management only — this page carries project-level financials.
  if (!(await checkIsCcReviewer())) redirect('/cost-control')
  // ?all=1 shows every pending budget (all approvers), not just my queue.
  const showAll = (await searchParams).all === '1'

  const user = await getMyUser()
  const supabase = await createClient()
  // Toggles decide whether ₹/sft and the ERP Budget·WO·Paid strip show — the
  // SAME switches the Internal Estimate page respects, so the numbers here and
  // there stay in lock-step.
  const ccSettings = await getCcSettings()

  // Every stage of the 3-step chain stays pending until fully released. Read
  // from the versioned view so each sheet carries chain_anchor_id / version_no
  // (for the "vs last revision" flag) alongside its money.
  const { data: pendingWS, error: wsErr } = await supabase
    .from('cc_ws_with_versions')
    .select(
      `id, ws_code, status, total_amount, approved_for_erp_amt, submitted_at, engineer_id, discipline_id, sub_skill_id, project_id, chain_anchor_id, version_no,
       projects(code, name, built_up_sft),
       cc_disciplines(code, name),
       cc_sub_skills(code, name)`,
    )
    .in('status', ['submitted', 'ph_approved', 'atm_approved', 'partially_approved'])
    .is('archived_at', null)
    .order('submitted_at', { ascending: true })

  const rows = (pendingWS ?? []) as unknown as WSRow[]
  const pendingProjectIds = [...new Set(rows.map(r => r.project_id))]
  // Chains we must fetch prior versions for = only the pending sheets that are
  // themselves a revision (v2+). v1 sheets have no "previous" to compare to.
  const revAnchors = [
    ...new Set(rows.filter(r => Number(r.version_no ?? 1) > 1 && r.chain_anchor_id).map(r => r.chain_anchor_id as string)),
  ]

  // Everything needed to answer "is this waiting on ME?" — my effective role,
  // the disciplines I head, and the named-approver map for the pending
  // projects (mine + which project/stage pairs have ANY named approver).
  const [{ data: prof }, { data: eff }, { data: myDisc, error: discErr }, { data: approvers, error: apprErr }, { data: budgetLines }, { data: priorVersions }] =
    await Promise.all([
      supabase.from('profiles').select('role').eq('id', user?.id ?? '').maybeSingle(),
      supabase.rpc('effective_user_role', { p_user_id: user?.id ?? '', p_module_slug: 'cost-control' }),
      supabase.from('cc_discipline_approvers').select('discipline_id').eq('approver_user_id', user?.id ?? '').eq('is_active', true),
      pendingProjectIds.length
        ? supabase.from('cc_project_approvers').select('project_id, role, user_id').in('project_id', pendingProjectIds)
        : Promise.resolve({ data: [] as Array<{ project_id: string; role: string; user_id: string }>, error: null }),
      pendingProjectIds.length
        ? supabase.from('cc_budget_lines').select('project_id, discipline_id, sub_skill_id, current_budget_amt, current_wo_committed_amt, current_paid_amt').in('project_id', pendingProjectIds)
        : Promise.resolve({ data: [] as BudgetLineRow[], error: null }),
      revAnchors.length
        ? supabase.from('cc_ws_with_versions').select('chain_anchor_id, version_no, total_amount').in('chain_anchor_id', revAnchors)
        : Promise.resolve({ data: [] as Array<{ chain_anchor_id: string | null; version_no: number | null; total_amount: number | null }>, error: null }),
    ])

  const queryErr = wsErr ?? discErr ?? apprErr
  if (queryErr) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
        <PageHeader title="My Approvals" subtitle="Working sheets waiting for your decision" back="/cost-control" />
        <QueryError message={queryErr.message} what="the approvals inbox" />
      </div>
    )
  }

  // ── Per-sheet "vs last revision" enrichment (kept from the money rollup so
  // the flag matches the project page). The ERP strip is computed but the new
  // project-grouped card only surfaces the revision delta. ──
  const blMap = new Map<string, { budget: number; wo: number; paid: number }>()
  for (const b of (budgetLines ?? []) as BudgetLineRow[]) {
    const k = `${b.project_id}::${b.discipline_id}::${b.sub_skill_id ?? '_root'}`
    const cur = blMap.get(k) ?? { budget: 0, wo: 0, paid: 0 }
    cur.budget += Number(b.current_budget_amt ?? 0)
    cur.wo += Number(b.current_wo_committed_amt ?? 0)
    cur.paid += Number(b.current_paid_amt ?? 0)
    blMap.set(k, cur)
  }

  const chainVers = new Map<string, Array<{ ver: number; total: number }>>()
  for (const v of (priorVersions ?? []) as Array<{ chain_anchor_id: string | null; version_no: number | null; total_amount: number | null }>) {
    if (!v.chain_anchor_id) continue
    const arr = chainVers.get(v.chain_anchor_id) ?? []
    arr.push({ ver: Number(v.version_no ?? 1), total: Number(v.total_amount ?? 0) })
    chainVers.set(v.chain_anchor_id, arr)
  }

  const perSft = (amt: number, sft: number): string | null =>
    ccSettings.show_per_sft && sft > 0 && amt > 0
      ? `₹${Math.round(amt / sft).toLocaleString('en-IN')}/sft`
      : null

  const enrich = new Map<string, WSEnrichment>()
  for (const ws of rows) {
    const sft = Number(pickFirst(ws.projects)?.built_up_sft ?? 0)
    const est = Number(ws.total_amount ?? 0)

    const bl = ws.sub_skill_id ? blMap.get(`${ws.project_id}::${ws.discipline_id}::${ws.sub_skill_id}`) : undefined
    const erp = ccSettings.show_erp_columns && bl && (bl.budget !== 0 || bl.wo !== 0 || bl.paid !== 0)
      ? {
          budget: bl.budget, wo: bl.wo, paid: bl.paid,
          budgetPerSft: perSft(bl.budget, sft),
          paidPerSft: perSft(bl.paid, sft),
          woPct: bl.budget > 0 ? Math.round((bl.wo / bl.budget) * 100) : null,
          paidPct: bl.budget > 0 ? Math.round((bl.paid / bl.budget) * 100) : null,
        }
      : null

    let prev: WSEnrichment['prev'] = null
    const ver = Number(ws.version_no ?? 1)
    if (ws.chain_anchor_id && ver > 1) {
      const earlier = (chainVers.get(ws.chain_anchor_id) ?? []).filter(v => v.ver < ver).sort((a, b) => b.ver - a.ver)
      if (earlier.length) {
        const p = earlier[0]
        prev = { total: p.total, ver: p.ver, deltaPct: p.total > 0 ? Math.round(((est - p.total) / p.total) * 100) : null }
      }
    }

    enrich.set(ws.id, { perSftEst: perSft(est, sft), erp, erpNew: ccSettings.show_erp_columns && !erp, prev })
  }

  const approverRows = (approvers ?? []) as Array<{ project_id: string; role: string; user_id: string }>
  const ctx: MyApprovalContext = {
    isAdmin: (prof?.role as string | null) === 'admin',
    effectiveRole: (eff as string | null) ?? (prof?.role as string | null) ?? null,
    myDisciplineIds: new Set((myDisc ?? []).map(d => d.discipline_id as string)),
    myNamedCover: new Set(approverRows.filter(a => a.user_id === user?.id).map(a => `${a.project_id}:${a.role}`)),
    projectRolesWithNamedApprover: new Set(approverRows.map(a => `${a.project_id}:${a.role}`)),
  }

  const mine = rows.filter(r => isWaitingOnMe(r, ctx))

  // The money a pending sheet ADDS to "approved" once fully signed off = its
  // ask minus whatever's already been released on its chain.
  const increment = (r: WSRow) => Math.max(0, Number(r.total_amount ?? 0) - Number(r.approved_for_erp_amt ?? 0))
  const pendingValue = (list: WSRow[]) => list.reduce((a, r) => a + increment(r), 0)

  // ── "Before" = budgets already signed off, per project and per (project,
  // discipline). Reuse the exact Internal-Estimate money rollup so these numbers
  // match the project page. Needs every live sheet for the pending projects. ──
  const { data: allSheetRows, error: allErr } = pendingProjectIds.length
    ? await supabase
        .from('cc_ws_with_versions')
        .select('id, project_id, discipline_id, sub_skill_id, status, total_amount, approved_for_erp_amt, summary_notes, entry_mode, chain_anchor_id, version_no')
        .in('project_id', pendingProjectIds)
    : { data: [] as RollupSheetRow[], error: null }
  const haveApproved = !allErr

  const approvedByProject = new Map<string, number>()
  const approvedByDisc = new Map<string, number>()  // key `${project}::${discipline}`
  const approvedBySub = new Map<string, number>()   // key `${project}::${discipline}::${sub_skill}`
  {
    const byProj = new Map<string, RollupSheetRow[]>()
    for (const s of (allSheetRows ?? []) as RollupSheetRow[]) {
      const a = byProj.get(s.project_id)
      if (a) a.push(s); else byProj.set(s.project_id, [s])
    }
    for (const [pid, sheets] of byProj) {
      const roll = computeMoneyRollup({ wsRows: sheets, versionRows: sheets, budgetLines: [], subSkills: [], disciplines: [] })
      let total = 0
      // wsAgg is keyed `${discipline}::${sub_skill}` within a project.
      for (const [key, agg] of roll.wsAgg) {
        const disc = key.slice(0, key.indexOf('::'))
        approvedByDisc.set(`${pid}::${disc}`, (approvedByDisc.get(`${pid}::${disc}`) ?? 0) + agg.approvedTotal)
        approvedBySub.set(`${pid}::${key}`, (approvedBySub.get(`${pid}::${key}`) ?? 0) + agg.approvedTotal)
        total += agg.approvedTotal
      }
      approvedByProject.set(pid, total)
    }
  }

  // Which sheets to show — my queue by default, everything pending via ?all=1.
  const visible = showAll ? rows : mine

  // Group the visible sheets by project (ordered by pending value, biggest first).
  const byProject = new Map<string, WSRow[]>()
  const projOrder: string[] = []
  for (const r of visible) {
    const a = byProject.get(r.project_id)
    if (a) a.push(r); else { byProject.set(r.project_id, [r]); projOrder.push(r.project_id) }
  }
  projOrder.sort((a, b) => pendingValue(byProject.get(b) ?? []) - pendingValue(byProject.get(a) ?? []))

  const hasThumbruleMine = mine.length > 0

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="My Approvals"
        subtitle={
          mine.length > 0
            ? `${mine.length} waiting on you · ${formatINR(pendingValue(mine))} to decide`
            : 'Nothing waiting on you right now'
        }
        back="/cost-control"
      />

      {/* View-all toggle — always visible, for every approver, so the full
          pending list is one tap away (not tucked inside a stage). */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-gray-500">
          {showAll
            ? `All pending budgets · ${rows.length} across ${projOrder.length} project${projOrder.length === 1 ? '' : 's'}`
            : `${mine.length} waiting on you across ${projOrder.length} project${projOrder.length === 1 ? '' : 's'}`}
        </p>
        <Link
          href={showAll ? '/cost-control/approvals' : '/cost-control/approvals?all=1'}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
        >
          {showAll ? 'Show only mine' : 'View all pending budgets'} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {hasThumbruleMine && (
        <Link
          href="/cost-control/approvals/thumbrule"
          className="block rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-2.5 hover:bg-amber-50/80 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2">
              <Ruler className="h-4 w-4 text-amber-700" />
              <span className="text-sm font-semibold text-amber-900">Bulk approve Thumbrule sheets</span>
              <span className="text-xs text-amber-700">— review rate × area on one page, approve in one click</span>
            </div>
            <ArrowRight className="h-4 w-4 text-amber-700" />
          </div>
        </Link>
      )}

      {projOrder.length === 0 ? (
        <Card className="p-10 text-center text-gray-500 text-sm">
          <Inbox className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <div>{showAll ? 'No budgets are pending right now.' : 'Nothing is waiting on you right now.'}</div>
          {!showAll && rows.length > 0 && (
            <Link href="/cost-control/approvals?all=1" className="inline-block mt-2 text-blue-700 hover:underline text-sm">
              View all pending budgets →
            </Link>
          )}
        </Card>
      ) : (
        projOrder.map(pid => {
          const items = byProject.get(pid) ?? []
          const proj = pickFirst(items[0].projects)
          const code = proj?.code ?? ''
          const tone = toneFor(code || pid)
          const projBefore = approvedByProject.get(pid) ?? 0
          const projInc = items.reduce((s, r) => s + increment(r), 0)

          // Group this project's shown budgets by sub-discipline.
          const byDisc = new Map<string, WSRow[]>()
          const discOrder: string[] = []
          for (const r of items) {
            const a = byDisc.get(r.discipline_id)
            if (a) a.push(r); else { byDisc.set(r.discipline_id, [r]); discOrder.push(r.discipline_id) }
          }

          return (
            <Card key={pid} className={`p-0 overflow-hidden border-l-4 ${tone.rail}`}>
              <div className={`px-4 py-3 ${tone.head} border-b border-gray-100`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm flex-shrink-0 ${tone.avatar}`}>🏢</span>
                    <span className="font-bold text-gray-900 truncate">{proj?.name ?? '—'}</span>
                    {code && <span className={`font-mono text-[11px] rounded px-1.5 py-0.5 flex-shrink-0 ${tone.code}`}>{code}</span>}
                  </div>
                  <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold px-2.5 py-0.5 whitespace-nowrap">
                    {items.length} {showAll ? 'pending' : 'waiting on you'}
                  </span>
                </div>
                {haveApproved && (
                  <div className="mt-2 flex items-baseline gap-x-2 gap-y-0.5 flex-wrap tabular-nums">
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">Project budget approved</span>
                    <span className="text-base font-bold text-gray-900">{formatINR(projBefore)}</span>
                    <ArrowRight className="h-3 w-3 text-gray-400 self-center" />
                    <span className="text-sm font-bold text-emerald-700">{formatINR(projBefore + projInc)}</span>
                    <span className="text-[11px] text-gray-500">if you approve {items.length === 1 ? 'this' : 'these'} (+{formatINR(projInc)})</span>
                  </div>
                )}
              </div>

              <div className="p-3 md:p-4 space-y-4">
                {discOrder.map(did => {
                  const ditems = byDisc.get(did) ?? []
                  const disc = pickFirst(ditems[0].cc_disciplines)
                  const discBefore = approvedByDisc.get(`${pid}::${did}`) ?? 0
                  const discInc = ditems.reduce((s, r) => s + increment(r), 0)
                  return (
                    <div key={did}>
                      <div className="flex items-baseline justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg bg-gray-100/70 border border-gray-200">
                        <span className="text-[11px] font-bold text-gray-700 uppercase tracking-wide truncate inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-sm bg-gray-400 flex-shrink-0" />
                          {disc?.name ?? '—'}
                        </span>
                        {haveApproved && (
                          <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap normal-case">
                            approved <b className="text-gray-800">{formatINR(discBefore)}</b> → <b className="text-emerald-700">{formatINR(discBefore + discInc)}</b>
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {ditems.map(ws => {
                          const sub = pickFirst(ws.cc_sub_skills)
                          const ex = enrich.get(ws.id)
                          const inc = increment(ws)
                          const subBefore = approvedBySub.get(`${pid}::${ws.discipline_id}::${ws.sub_skill_id}`) ?? 0
                          const mineFlag = isWaitingOnMe(ws, ctx)
                          const href = `/cost-control/working-sheets/${ws.id}?from=approvals`
                          const d = daysWaiting(ws.submitted_at)
                          const ver = Number(ws.version_no ?? 1)
                          return (
                            <div key={ws.id} className="rounded-xl border border-gray-200 bg-white p-3">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-medium text-gray-900">{sub?.name ?? disc?.name ?? '—'}</span>
                                    {ver > 1 && <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-gray-100 text-gray-600 border border-gray-200">Rev {ver}</span>}
                                    {ex?.prev && <RevisionFlag prev={ex.prev} />}
                                  </div>
                                  <p className="text-[11px] font-mono text-gray-400 mt-0.5">{ws.ws_code}</p>
                                  <StageChain status={ws.status} mine={mineFlag} />
                                </div>
                                <div className="text-right flex-shrink-0">
                                  <div className="font-bold text-gray-900 tabular-nums">{formatINR(ws.total_amount)}</div>
                                  {d >= 3
                                    ? <span className="inline-flex items-center rounded-full bg-rose-100 text-rose-800 border border-rose-200 text-[10px] font-bold px-2 py-0.5 mt-1">{d}d overdue</span>
                                    : <span className="text-[11px] text-gray-400">{d === 0 ? 'today' : `${d}d`}</span>}
                                </div>
                              </div>

                              {haveApproved && (
                                <div className={`mt-2.5 rounded-lg border px-3 py-2 text-xs tabular-nums ${tone.ba}`}>
                                  <p className="text-[10px] uppercase tracking-wide opacity-60 mb-1">Approved so far → after this</p>
                                  <div className="flex justify-between gap-2">
                                    <span className="opacity-80 truncate">{sub?.name ?? disc?.name ?? 'This line'}</span>
                                    <span className="flex-shrink-0"><b>{formatINR(subBefore)}</b> → <b className="text-emerald-700">{formatINR(subBefore + inc)}</b></span>
                                  </div>
                                  <div className="flex justify-between gap-2 mt-1">
                                    <span className="opacity-80 truncate">{disc?.name ?? 'Discipline'} <span className="opacity-60">(discipline)</span></span>
                                    <span className="flex-shrink-0"><b>{formatINR(discBefore)}</b> → <b className="text-emerald-700">{formatINR(discBefore + inc)}</b></span>
                                  </div>
                                  <div className="flex justify-between gap-2 mt-1 pt-1 border-t border-black/5">
                                    <span className="opacity-80">Project total</span>
                                    <span className="flex-shrink-0"><b>{formatINR(projBefore)}</b> → <b className="text-emerald-700">{formatINR(projBefore + inc)}</b></span>
                                  </div>
                                </div>
                              )}

                              <div className="mt-2.5 flex items-center justify-between gap-2">
                                <a
                                  href={`/api/cost-control/working-sheets/${ws.id}/download`}
                                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-blue-700"
                                >
                                  <Download className="h-3.5 w-3.5" /> Budget Excel
                                </a>
                                <Link
                                  href={href}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-3.5 py-1.5"
                                >
                                  {mineFlag ? 'Review & approve' : 'Review'} <ArrowRight className="h-3.5 w-3.5" />
                                </Link>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })
      )}
    </div>
  )
}

// The compact "vs last revision" chip. Up = the ask grew (caution, amber);
// down = it shrank (good, emerald).
function RevisionFlag({ prev }: { prev: NonNullable<WSEnrichment['prev']> }) {
  const dp = prev.deltaPct
  const up = (dp ?? 0) > 0
  const down = (dp ?? 0) < 0
  const tone = up ? 'bg-amber-50 text-amber-800' : down ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-100 text-gray-600'
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded ${tone} px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap`}
      title={`Previous revision v${prev.ver}: ${formatINR(prev.total)}`}
    >
      {up && <ArrowUpRight className="h-3 w-3" />}
      {down && <ArrowDownRight className="h-3 w-3" />}
      {dp == null ? 'changed' : dp === 0 ? 'same' : `${dp > 0 ? '+' : ''}${dp}%`} vs v{prev.ver}
    </span>
  )
}

// The 3-step sign-off chain (Project Head → Atm Head → Trustee) with the
// current step highlighted — so the screen reads the same for every approver,
// each seeing where a budget sits and (when it's theirs) that it's on them.
function StageChain({ status, mine }: { status: string; mine: boolean }) {
  const cur = status === 'submitted' ? 1 : status === 'ph_approved' ? 2 : 3
  const stages = [
    { n: 1, label: 'PH' },
    { n: 2, label: 'Atm' },
    { n: 3, label: 'Trustee' },
  ]
  return (
    <div className="mt-1.5 flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-gray-400">sign-off</span>
      {stages.map(s => {
        const done = s.n < cur
        const isCur = s.n === cur
        const cls = done ? 'bg-emerald-50 text-emerald-700' : isCur ? 'bg-blue-50 text-blue-700 font-bold' : 'bg-gray-100 text-gray-500'
        const text = done ? `${s.label} ✓` : isCur && mine ? `${s.label} · you` : s.label
        return <span key={s.n} className={`text-[10px] rounded px-1.5 py-0.5 ${cls}`}>{text}</span>
      })}
    </div>
  )
}
