import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { isWaitingOnMe, type MyApprovalContext } from '@/lib/cost-control/my-approvals'
import { getCcSettings } from '@/lib/cost-control/settings'
import { formatINR } from '@/lib/utils'
import { Inbox, ArrowRight, Ruler, ChevronDown, ArrowUpRight, ArrowDownRight } from 'lucide-react'

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
  prev: { total: number; ver: number; deltaPct: number | null } | null
}

function pickFirst<T>(v: T | T[] | null): T | null {
  if (!v) return null
  return Array.isArray(v) ? v[0] ?? null : v
}

export default async function ApprovalsInboxPage() {
  await requirePermission('cost-control', 'view')
  // Management only — this page carries project-level financials.
  if (!(await checkIsCcReviewer())) redirect('/cost-control')

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
      <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
        <PageHeader title="My Approvals" subtitle="Working sheets waiting for your decision" back="/cost-control" />
        <QueryError message={queryErr.message} what="the approvals inbox" />
      </div>
    )
  }

  // ── Build the per-sheet "full picture" enrichment ──────────────────────────
  // Budget · WO · Paid for each (project, discipline, sub-skill), summed across
  // line_types (a pair can carry several rows — dropping any would undercount).
  const blMap = new Map<string, { budget: number; wo: number; paid: number }>()
  for (const b of (budgetLines ?? []) as BudgetLineRow[]) {
    const k = `${b.project_id}::${b.discipline_id}::${b.sub_skill_id ?? '_root'}`
    const cur = blMap.get(k) ?? { budget: 0, wo: 0, paid: 0 }
    cur.budget += Number(b.current_budget_amt ?? 0)
    cur.wo += Number(b.current_wo_committed_amt ?? 0)
    cur.paid += Number(b.current_paid_amt ?? 0)
    blMap.set(k, cur)
  }

  // Previous-revision totals per chain: for a v(N) sheet, compare against the
  // highest version below N in the same chain.
  const chainVers = new Map<string, Array<{ ver: number; total: number }>>()
  for (const v of (priorVersions ?? []) as Array<{ chain_anchor_id: string | null; version_no: number | null; total_amount: number | null }>) {
    if (!v.chain_anchor_id) continue
    const arr = chainVers.get(v.chain_anchor_id) ?? []
    arr.push({ ver: Number(v.version_no ?? 1), total: Number(v.total_amount ?? 0) })
    chainVers.set(v.chain_anchor_id, arr)
  }

  // ₹/sft on a project's built-up area — hidden when area or the toggle is off.
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

    enrich.set(ws.id, { perSftEst: perSft(est, sft), erp, prev })
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
  const others = rows.filter(r => !isWaitingOnMe(r, ctx))

  const pendingValue = (list: WSRow[]) =>
    list.reduce((a, r) => a + Math.max(Number(r.total_amount ?? 0) - Number(r.approved_for_erp_amt ?? 0), 0), 0)

  // My queue, split by the stage it's waiting on (a person usually sits at one
  // stage; an admin sees all three).
  const mineByStage = {
    ph:  mine.filter(r => r.status === 'submitted'),
    atm: mine.filter(r => r.status === 'ph_approved'),
    tru: mine.filter(r => r.status === 'atm_approved' || r.status === 'partially_approved'),
  }
  const othersByStage = {
    ph:  others.filter(r => r.status === 'submitted'),
    atm: others.filter(r => r.status === 'ph_approved'),
    tru: others.filter(r => r.status === 'atm_approved' || r.status === 'partially_approved'),
  }
  const hasThumbruleMine = mine.length > 0

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="My Approvals"
        subtitle={
          mine.length > 0
            ? `${mine.length} waiting on you · ${formatINR(pendingValue(mine))} to decide`
            : 'Nothing waiting on you right now'
        }
        back="/cost-control"
      />

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

      {/* ── MY queue ── */}
      {mine.length > 0 ? (
        <>
          <ApprovalSection title="Awaiting your sign-off — Project Head" subtitle="Stage 1 of 3" rows={mineByStage.ph} enrich={enrich} highlight />
          <ApprovalSection title="Awaiting your sign-off — Atm Head" subtitle="Stage 2 of 3" rows={mineByStage.atm} enrich={enrich} highlight />
          <ApprovalSection title="Awaiting your release — Trustee" subtitle="Stage 3 of 3 — release into ERP" rows={mineByStage.tru} enrich={enrich} highlight />
        </>
      ) : (
        <Card className="p-10 text-center text-gray-500 text-sm">
          <Inbox className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <div>Nothing is waiting on you right now.</div>
          <Link href="/cost-control/working-sheets" className="inline-block mt-2 text-blue-700 hover:underline text-sm">
            Browse all working sheets →
          </Link>
        </Card>
      )}

      {/* ── The rest of the team's pending, collapsed so it doesn't distract ── */}
      {others.length > 0 && (
        <details className="rounded-lg border border-gray-200 bg-white group">
          <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none select-none hover:bg-gray-50">
            <span className="text-sm font-semibold text-gray-700">
              Rest of the team&apos;s pending
              <span className="ml-2 text-xs font-normal text-gray-500">
                {others.length} sheet{others.length === 1 ? '' : 's'} · {formatINR(pendingValue(others))} — waiting on others
              </span>
            </span>
            <ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-gray-100 p-3 space-y-3">
            <ApprovalSection title="Awaiting Project Head" subtitle="Stage 1 of 3" rows={othersByStage.ph} enrich={enrich} />
            <ApprovalSection title="Awaiting Atm Head" subtitle="Stage 2 of 3" rows={othersByStage.atm} enrich={enrich} />
            <ApprovalSection title="Awaiting Trustee" subtitle="Stage 3 of 3" rows={othersByStage.tru} enrich={enrich} />
          </div>
        </details>
      )}
    </div>
  )
}

// The compact "vs last revision" chip used in the desktop table. Up = the ask
// grew (caution, amber); down = it shrank (good, emerald).
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

function ApprovalSection({
  title,
  subtitle,
  rows,
  enrich,
  highlight = false,
}: {
  title: string
  subtitle: string
  rows: WSRow[]
  enrich: Map<string, WSEnrichment>
  highlight?: boolean
}) {
  if (rows.length === 0) return null
  return (
    <Card className={`p-0 overflow-hidden ${highlight ? 'border-amber-200' : ''}`}>
      <div className={`px-4 py-3 border-b ${highlight ? 'bg-amber-50 border-amber-100' : 'bg-gray-50 border-gray-100'}`}>
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Code</th>
              <th className="text-left px-3 py-2 font-medium">Project</th>
              <th className="text-left px-3 py-2 font-medium">Discipline · Sub-skill</th>
              <th className="text-right px-3 py-2 font-medium">Amount</th>
              <th className="text-left px-3 py-2 font-medium">Waiting</th>
              <th className="text-left px-3 py-2 font-medium">Status</th>
              <th className="text-right px-3 py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(ws => {
              const proj = pickFirst(ws.projects)
              const disc = pickFirst(ws.cc_disciplines)
              const sub = pickFirst(ws.cc_sub_skills)
              const est = Number(ws.total_amount ?? 0)
              const released = Number(ws.approved_for_erp_amt ?? 0)
              const partial = ws.status === 'partially_approved' && released > 0
              const ex = enrich.get(ws.id)
              // ?from=approvals surfaces the "Back to My Approvals" link on the sheet.
              const href = `/cost-control/working-sheets/${ws.id}?from=approvals`
              return (
                <tr key={ws.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-700">
                    <Link href={href} className="hover:text-blue-700">{ws.ws_code}</Link>
                  </td>
                  <td className="px-3 py-2.5 font-medium text-gray-900">
                    {proj?.name ?? '—'} <span className="text-xs font-mono text-gray-500">{proj?.code}</span>
                  </td>
                  <td className="px-3 py-2.5 text-gray-700">
                    <div><span className="text-xs text-gray-500 font-mono">{disc?.code}</span> {disc?.name} · {sub?.name}</div>
                    {ex?.erp && (
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-gray-500">
                        <span>Budget <span className="font-medium text-gray-700 tabular-nums">{formatINR(ex.erp.budget)}</span></span>
                        <span>WO <span className="font-medium text-gray-700 tabular-nums">{formatINR(ex.erp.wo)}</span>{ex.erp.woPct != null ? ` · ${ex.erp.woPct}%` : ''}</span>
                        <span>Paid <span className="font-medium text-gray-700 tabular-nums">{formatINR(ex.erp.paid)}</span>{ex.erp.paidPct != null ? ` · ${ex.erp.paidPct}% used` : ''}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="font-semibold text-gray-900 tabular-nums">{formatINR(ws.total_amount)}</div>
                    {ex?.perSftEst && <div className="text-[11px] font-normal text-gray-500 whitespace-nowrap">{ex.perSftEst}</div>}
                    {partial && (
                      <div className="text-[11px] font-normal text-amber-700 whitespace-nowrap mt-0.5">
                        {formatINR(released)} of {formatINR(est)} released — {formatINR(Math.max(est - released, 0))} remaining
                      </div>
                    )}
                    {ex?.prev && <div className="mt-0.5 flex justify-end"><RevisionFlag prev={ex.prev} /></div>}
                  </td>
                  <td className="px-3 py-2.5">
                    {(() => {
                      const d = daysWaiting(ws.submitted_at)
                      if (d >= 3) return <span className="inline-flex items-center rounded-full bg-rose-100 text-rose-800 border border-rose-200 text-[11px] font-bold px-2 py-0.5">{d}d overdue</span>
                      if (d > 0) return <span className="text-xs text-gray-600">{d}d</span>
                      return <span className="text-xs text-gray-400">today</span>
                    })()}
                  </td>
                  <td className="px-3 py-2.5">
                    <WSStatusPill status={ws.status as WSStatus} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Link href={href} className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 text-sm font-medium">
                      Review <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile: each pending sheet as a full-picture card — estimate + ₹/sft,
          the Budget·WO·Paid strip, a paid bar, and how it compares to the last
          revision, so an approver can decide from the phone. */}
      <div className="md:hidden divide-y divide-gray-100">
        {rows.map(ws => {
          const proj = pickFirst(ws.projects)
          const disc = pickFirst(ws.cc_disciplines)
          const sub = pickFirst(ws.cc_sub_skills)
          const est = Number(ws.total_amount ?? 0)
          const released = Number(ws.approved_for_erp_amt ?? 0)
          const partial = ws.status === 'partially_approved' && released > 0
          const ex = enrich.get(ws.id)
          const href = `/cost-control/working-sheets/${ws.id}?from=approvals`
          const d = daysWaiting(ws.submitted_at)
          return (
            <Link key={ws.id} href={href} className="block px-4 py-3.5 hover:bg-gray-50">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900">{proj?.name ?? '—'} <span className="text-xs font-mono text-gray-500">{proj?.code}</span></p>
                  <p className="text-xs text-gray-600 mt-0.5"><span className="font-mono text-gray-400">{disc?.code}</span> {disc?.name} · {sub?.name}</p>
                  <p className="text-[11px] font-mono text-gray-400 mt-0.5">{ws.ws_code}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] uppercase tracking-wide text-gray-400">This estimate</p>
                  <p className="font-semibold text-gray-900 tabular-nums leading-tight">{formatINR(ws.total_amount)}</p>
                  {ex?.perSftEst && <p className="text-[11px] text-gray-500">{ex.perSftEst}</p>}
                </div>
              </div>

              {ex?.erp && (
                <div className="mt-2.5 rounded-lg bg-gray-50 border border-gray-100 grid grid-cols-3 text-center">
                  <div className="px-2 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Budget</p>
                    <p className="text-xs font-semibold text-gray-800 tabular-nums">{formatINR(ex.erp.budget)}</p>
                    {ex.erp.budgetPerSft && <p className="text-[10px] text-gray-400">{ex.erp.budgetPerSft}</p>}
                  </div>
                  <div className="px-2 py-2 border-x border-gray-200">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">WO</p>
                    <p className="text-xs font-semibold text-gray-800 tabular-nums">{formatINR(ex.erp.wo)}</p>
                    {ex.erp.woPct != null && <p className="text-[10px] text-gray-400">{ex.erp.woPct}% of bgt</p>}
                  </div>
                  <div className="px-2 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">Paid</p>
                    <p className="text-xs font-semibold text-gray-800 tabular-nums">{formatINR(ex.erp.paid)}</p>
                    {ex.erp.paidPerSft && <p className="text-[10px] text-gray-400">{ex.erp.paidPerSft}</p>}
                  </div>
                </div>
              )}
              {ex?.erp?.paidPct != null && (
                <div className="mt-1.5">
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${Math.min(ex.erp.paidPct, 100)}%` }} />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">{ex.erp.paidPct}% of budget paid</p>
                </div>
              )}

              {ex?.prev && (() => {
                const dp = ex.prev.deltaPct
                const tone = (dp ?? 0) > 0 ? 'bg-amber-50 text-amber-800' : (dp ?? 0) < 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-gray-50 text-gray-600'
                return (
                  <div className={`mt-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] ${tone}`}>
                    {(dp ?? 0) < 0 ? <ArrowDownRight className="h-3.5 w-3.5 flex-shrink-0" /> : <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0" />}
                    <span>
                      {dp == null
                        ? <>Changed from last revision (v{ex.prev.ver}) · was {formatINR(ex.prev.total)}</>
                        : dp === 0
                          ? <>Same as last revision (v{ex.prev.ver}) · {formatINR(ex.prev.total)}</>
                          : <>{dp > 0 ? 'Up' : 'Down'} <b className="font-semibold">{Math.abs(dp)}%</b> from last revision (v{ex.prev.ver}) · was {formatINR(ex.prev.total)}</>}
                    </span>
                  </div>
                )
              })()}

              {partial && (
                <p className="text-[11px] text-amber-700 mt-2">{formatINR(released)} of {formatINR(est)} released — {formatINR(Math.max(est - released, 0))} remaining</p>
              )}

              <div className="mt-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <WSStatusPill status={ws.status as WSStatus} />
                  {d >= 3
                    ? <span className="inline-flex items-center rounded-full bg-rose-100 text-rose-800 border border-rose-200 text-[11px] font-bold px-2 py-0.5">{d}d overdue</span>
                    : d > 0 ? <span className="text-xs text-gray-500">{d}d waiting</span> : <span className="text-xs text-gray-400">today</span>}
                </div>
                <span className="inline-flex items-center gap-1 text-blue-700 text-sm font-medium flex-shrink-0">Review <ArrowRight className="h-3.5 w-3.5" /></span>
              </div>
            </Link>
          )
        })}
      </div>
    </Card>
  )
}
