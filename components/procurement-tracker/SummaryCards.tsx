'use client'
import type { ProjectSummary } from '@/lib/procurement-tracker'

function fmt(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  return `₹${n.toLocaleString('en-IN')}`
}

export function SummaryCards({ summary }: { summary: ProjectSummary }) {
  const pct = (v: number) => summary.total > 0 ? Math.round((v / summary.total) * 100) : 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <p className="text-xs text-stone-500 mb-1">Total Indents</p>
        <p className="text-3xl font-semibold text-stone-800">{summary.total}</p>
        <p className="text-xs text-stone-400 mt-1">raised in ERP</p>
      </div>

      <div className="bg-white rounded-xl border border-emerald-200 p-4">
        <p className="text-xs text-emerald-600 mb-1">PO Done & GRN Received</p>
        <p className="text-3xl font-semibold text-emerald-700">{summary.poDoneGrnReceived}</p>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full"
              style={{ width: `${pct(summary.poDoneGrnReceived)}%` }}
            />
          </div>
          <span className="text-xs text-stone-400">{pct(summary.poDoneGrnReceived)}%</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-amber-200 p-4">
        <p className="text-xs text-amber-600 mb-1">PO Raised – GRN Pending</p>
        <p className="text-3xl font-semibold text-amber-700">{summary.poRaisedGrnPending}</p>
        <p className="text-xs text-stone-400 mt-1">material in transit</p>
      </div>

      <div className="bg-white rounded-xl border border-red-200 p-4">
        <p className="text-xs text-red-600 mb-1">No PO Raised</p>
        <p className="text-3xl font-semibold text-red-700">{summary.indentOnlyNoPo}</p>
        <p className="text-xs text-stone-400 mt-1">action needed</p>
      </div>

      <div className="col-span-2 sm:col-span-4 bg-stone-50 rounded-xl border border-stone-200 p-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-stone-500">Total GRN Value (material received on site)</p>
          <p className="text-2xl font-semibold text-stone-800">{fmt(summary.totalGrnValue)}</p>
        </div>
        <div className="text-right text-xs text-stone-400">
          <p>{summary.poDoneGrnReceived} of {summary.total} indents fulfilled</p>
          <p className="mt-0.5">{pct(summary.poDoneGrnReceived)}% completion</p>
        </div>
      </div>
    </div>
  )
}
