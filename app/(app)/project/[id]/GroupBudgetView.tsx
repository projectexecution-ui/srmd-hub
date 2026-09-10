import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { usedTone } from '@/lib/revamp/used-tone'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { loadGroupBudget, type GroupChild, type GroupTotal } from '@/lib/revamp/group-budget'

/**
 * The Budget landing when the project is a GROUP (NGH, P2, VV).
 *
 * Instead of the empty Internal Estimate of an anchor that holds no disciplines
 * of its own, this rolls up the sub-projects: five headline figures summed
 * across the children (lib/revamp/group-budget.ts, from the same rollup the
 * leaf uses), then one collapsed row per sub-project that opens its workspace.
 *
 * §10 / confidentiality: Internal Estimate is a reviewer-only column and card,
 * exactly as the leaf page gates it — a non-reviewer sees the group's ERP
 * budget, committed and paid, never the maintained estimate.
 */
export async function GroupBudgetView({ projectId }: { projectId: string }) {
  const [{ children, total }, reviewer] = await Promise.all([
    loadGroupBudget(projectId),
    checkIsCcReviewer(),
  ])

  if (children.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
        This is a group project, but it has no sub-projects yet.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Rolled-up headline figures — the same five the leaf shows. */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${reviewer ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3`}>
        {reviewer && (
          <KPI label="Internal Estimate" tone="indigo"
               value={total.internalEstimate > 0 ? formatINR(total.internalEstimate) : '—'}
               sub="Across all sub-projects" />
        )}
        <KPI label="Awaiting Approval" tone="amber"
             value={total.awaitingApproval > 0 ? formatINR(total.awaitingApproval) : '—'}
             sub={total.awaitingCount > 0
               ? `${total.awaitingCount} sheet${total.awaitingCount === 1 ? '' : 's'} in the chain`
               : 'Nothing pending'} />
        <KPI label="Approved Budget (ERP)" tone="blue"
             value={total.budgetErp > 0 ? formatINR(total.budgetErp) : '—'}
             sub={`${children.length} sub-project${children.length === 1 ? '' : 's'}`} />
        <KPI label="Committed (WO/PO)" tone="purple"
             value={total.wo > 0 ? formatINR(total.wo) : '—'}
             sub={total.budgetErp > 0 ? `${Math.round((total.wo / total.budgetErp) * 100)}% of budget` : '—'} />
        <KPI label="Paid to Date" tone="orange"
             value={total.paid > 0 ? formatINR(total.paid) : '—'}
             sub={total.usedPct != null ? `${total.usedPct}% of ERP budget` : '—'} />
      </div>

      {/* The sub-projects, collapsed — one line each, click to open. */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">Sub-projects</h2>
          <p className="text-[12px] text-gray-500">Open one to see its full budget</p>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2 text-left font-semibold">Sub-project</th>
                {reviewer && <th className="px-3 py-2 text-right font-semibold">Internal Estimate</th>}
                <th className="px-3 py-2 text-right font-semibold">Budget (ERP)</th>
                <th className="px-3 py-2 text-right font-semibold">WO / PO</th>
                <th className="px-3 py-2 text-right font-semibold">Paid</th>
                <th className="px-3 py-2 text-right font-semibold">% used</th>
                <th className="px-2 py-2" aria-hidden />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {children.map(c => (
                <tr key={c.id} className="hover:bg-indigo-50/40 group">
                  <td className="px-4 py-2.5">
                    <Link href={`/project/${c.id}`} className="flex items-center gap-2 min-w-0">
                      {c.chip && (
                        <span className="inline-flex rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold px-1.5 py-0.5 flex-shrink-0" title={c.code && c.code !== c.chip ? `Code ${c.code}` : undefined}>{c.chip}</span>
                      )}
                      <span className="font-medium text-gray-900 group-hover:text-indigo-700 truncate">{c.name}</span>
                      <StatusDot status={c.ccStatus} />
                    </Link>
                  </td>
                  {reviewer && <Money v={c.money.internalEstimate} />}
                  <Money v={c.money.budgetErp} />
                  <Money v={c.money.wo} />
                  <Money v={c.money.paid} />
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold">
                    <span className={usedTone(c.money.usedPct)}>{c.money.usedPct != null ? `${c.money.usedPct}%` : '—'}</span>
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-indigo-500 inline" />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                <td className="px-4 py-3">Total</td>
                {reviewer && <Money v={total.internalEstimate} bold />}
                <Money v={total.budgetErp} bold />
                <Money v={total.wo} bold />
                <Money v={total.paid} bold />
                <td className="px-3 py-3 text-right tabular-nums">
                  <span className={usedTone(total.usedPct)}>{total.usedPct != null ? `${total.usedPct}%` : '—'}</span>
                </td>
                <td className="px-2 py-3" aria-hidden />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-gray-100">
          {children.map(c => (
            <Link key={c.id} href={`/project/${c.id}`} className="block px-4 py-3 hover:bg-indigo-50/40">
              <div className="flex items-center gap-2">
                {c.chip && (
                  <span className="inline-flex rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold px-1.5 py-0.5">{c.chip}</span>
                )}
                <span className="font-medium text-gray-900 truncate">{c.name}</span>
                <StatusDot status={c.ccStatus} />
                <ChevronRight className="h-4 w-4 text-gray-300 ml-auto flex-shrink-0" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                {reviewer && <Cell label="Internal Estimate" v={c.money.internalEstimate} />}
                <Cell label="Budget (ERP)" v={c.money.budgetErp} />
                <Cell label="WO / PO" v={c.money.wo} />
                <Cell label="Paid" v={c.money.paid} />
                <div className="flex justify-between">
                  <span className="text-gray-500">% used</span>
                  <span className={`tabular-nums font-semibold ${usedTone(c.money.usedPct)}`}>{c.money.usedPct != null ? `${c.money.usedPct}%` : '—'}</span>
                </div>
              </div>
            </Link>
          ))}
          <div className="px-4 py-3 bg-gray-50 flex items-center justify-between text-[13px] font-semibold">
            <span>Total · {children.length} sub-projects</span>
            <span className="tabular-nums">{total.budgetErp > 0 ? formatINR(total.budgetErp) : '—'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── small pieces ───────────────────────────────────────────────────────── */

function Money({ v, bold }: { v: number; bold?: boolean }) {
  return (
    <td className={`px-3 py-2.5 text-right tabular-nums ${bold ? 'font-semibold' : 'text-gray-800'}`}>
      {v > 0 ? formatINR(v) : <span className="text-gray-300">—</span>}
    </td>
  )
}

function Cell({ label, v }: { label: string; v: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="tabular-nums text-gray-800">{v > 0 ? formatINR(v) : '—'}</span>
    </div>
  )
}

function StatusDot({ status }: { status: string | null }) {
  if (!status || status === 'active') return null
  const tone = status === 'completed' ? 'bg-blue-100 text-blue-700'
    : status === 'on_hold' ? 'bg-amber-100 text-amber-800'
    : 'bg-gray-100 text-gray-600'
  return <span className={`inline-flex rounded-full text-[10px] font-bold px-1.5 py-0.5 ${tone}`}>{status.replace('_', ' ')}</span>
}

function KPI({
  label, value, sub, tone,
}: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone: 'blue' | 'purple' | 'orange' | 'indigo' | 'amber' }) {
  const top = {
    blue: 'border-t-blue-500', purple: 'border-t-purple-500', orange: 'border-t-orange-500',
    indigo: 'border-t-indigo-500', amber: 'border-t-amber-500',
  }[tone]
  return (
    <div className={`bg-white rounded-md border border-gray-200 border-t-2 ${top} p-4`}>
      <p className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}
