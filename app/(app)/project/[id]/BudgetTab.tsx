import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { loadCtWise } from '@/lib/revamp/budget-actual-data'
import ProjectInternalEstimatePage from '@/app/(app)/cost-control/projects/[id]/page'
import { OrdersView } from './OrdersView'

/**
 * Budget vs Actual (build order §2) — three views behind the sub-tab pills.
 *
 *   0  Category / sub-category wise   CT Hub's Internal Estimate — the live page
 *   1  Category — WO/PO wise          the orders tree, live from IN4
 *   2  CT wise                        sub-project roll-up from IN4, flat
 *
 * Pill 1 RENDERS THE LIVE INTERNAL ESTIMATE PAGE, it does not reproduce it.
 * Aksha, 6 Sept 2026: "The Budget should also be same as CT Hub".
 *
 * §2 was first built as its own table that recomputed the same figures. It
 * matched to the rupee and was tested against real NGH B rows, and it was
 * still the wrong shape for two reasons:
 *
 *  1. It looked different. People who read this screen every day had to learn
 *     a second layout for the same numbers.
 *  2. It leaked. The live page shows the Internal Estimate column ONLY to a
 *     Cost Control reviewer and hands everyone else a separate safe view
 *     without it — a rule enforced in code, not by the permission matrix. The
 *     replacement table had no such gate while the tab was open on
 *     `cost-control` view, which all eight roles hold. The [IB…] baseline was
 *     therefore reachable by engineers, viewers and site staff.
 *
 * Rendering the live component fixes both at once, and settles a third thing:
 * there is no longer any figure to reconcile, because the tab and the Cost
 * Control page are the same code.
 *
 * `in_cockpit=1` is what stops that page bouncing back to this one on the
 * trial deployment, where every route into a project redirects here.
 */
export async function BudgetTab({ projectId, view }: { projectId: string; view: number }) {
  if (view === 2) return <CtWiseView projectId={projectId} />
  if (view === 1) return <OrdersView projectId={projectId} />
  return (
    <ProjectInternalEstimatePage
      params={Promise.resolve({ id: projectId })}
      searchParams={Promise.resolve({ in_cockpit: '1' })}
    />
  )
}

/* ── table helpers, shared by the views below ───────────────────────────── */

const Dash = () => <span className="text-gray-300">—</span>

/** A money cell. §10: null means IN4 or CT Hub does not hold the figure, and
 *  an em-dash says so — a zero here would read as a real amount. */
function Money({ v, perSft, bold }: { v: number | null; perSft: number | null; bold?: boolean }) {
  if (v == null) return <Dash />
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={bold ? 'tabular-nums font-semibold' : 'tabular-nums'}>{formatINR(Math.round(v))}</span>
      {perSft != null && (
        <span className="text-[10.5px] text-gray-400 tabular-nums">₹{perSft.toLocaleString('en-IN')}/sft</span>
      )}
    </span>
  )
}

function Pct({ v }: { v: number | null }) {
  if (v == null) return <Dash />
  return <span className="tabular-nums">{v}%</span>
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 ${className ?? 'text-right'}`}>{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-2 text-right text-[13px] text-gray-800">{children}</td>
}
/* ── pill 3 — CT wise ───────────────────────────────────────────────────── */

async function CtWiseView({ projectId }: { projectId: string }) {
  const { rows, total, error, note } = await loadCtWise(projectId)

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
        <p className="text-sm font-semibold text-rose-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> The sub-project roll-up could not be read
        </p>
        <p className="text-xs text-rose-800 mt-1 font-mono break-all">{error}</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-semibold text-amber-900">Not linked to an IN4 sub-project yet</p>
        <p className="text-xs text-amber-800 mt-1">
          This roll-up reads IN4 sub-projects, and the link is a confirmed mapping rather than a
          name match. Confirm it on{' '}
          <Link href="/admin/masters/mapping" className="underline font-medium">Masters → Mapping</Link>{' '}
          and the rows appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur">
              <tr className="text-[10.5px] uppercase tracking-[0.04em] text-gray-500">
                <Th className="text-left pl-4">Sub-project</Th>
                <Th>Area (sft)</Th>
                <Th>Budget (ERP)</Th>
                <Th>WO / PO approved</Th>
                <Th>Uncommitted</Th>
                <Th>Certified</Th>
                <Th>% used</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => (
                <tr key={r.subprojectId} className="hover:bg-gray-50/60">
                  <td className="pl-4 pr-3 py-2.5 text-gray-900">{r.name}</td>
                  <Td>{r.areaSft == null ? <Dash /> : <span className="tabular-nums">{r.areaSft.toLocaleString('en-IN')}</span>}</Td>
                  <Td><Money v={r.budgetErp} perSft={null} /></Td>
                  <Td><Money v={r.woApproved} perSft={null} /></Td>
                  <Td><Money v={r.uncommitted} perSft={null} /></Td>
                  <Td><Money v={r.certified} perSft={null} /></Td>
                  <Td><Pct v={r.pctUsed} /></Td>
                </tr>
              ))}
              {total && (
                <tr className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                  <td className="pl-4 pr-3 py-3">Total</td>
                  <Td>{total.areaSft == null ? <Dash /> : <span className="tabular-nums">{total.areaSft.toLocaleString('en-IN')}</span>}</Td>
                  <Td><Money v={total.budgetErp} perSft={null} bold /></Td>
                  <Td><Money v={total.woApproved} perSft={null} bold /></Td>
                  <Td><Money v={total.uncommitted} perSft={null} bold /></Td>
                  <Td><Money v={total.certified} perSft={null} bold /></Td>
                  <Td><Pct v={total.pctUsed} /></Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11.5px] text-gray-400 leading-relaxed">{note}</p>
    </div>
  )
}
