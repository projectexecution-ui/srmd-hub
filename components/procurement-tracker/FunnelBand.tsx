'use client'
import type { ProjectSummary } from '@/lib/procurement-tracker'

export function FunnelBand({ summary }: { summary: ProjectSummary }) {
  const { total, indentOnlyNoPo, poRaisedGrnPending, poDoneGrnReceived } = summary
  return (
    <div className="bg-white rounded-xl border border-stone-200 px-4 py-3 mb-6 flex flex-wrap gap-x-6 gap-y-2 text-xs">
      <span className="inline-flex items-center gap-1.5 text-stone-600">
        <span className="h-2 w-2 rounded-full bg-red-500" />
        No PO yet
        <b className="text-stone-900 tabular-nums">{indentOnlyNoPo}</b>
      </span>
      <span className="inline-flex items-center gap-1.5 text-stone-600">
        <span className="h-2 w-2 rounded-full bg-amber-500" />
        PO raised — GRN pending
        <b className="text-stone-900 tabular-nums">{poRaisedGrnPending}</b>
      </span>
      <span className="inline-flex items-center gap-1.5 text-stone-600">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        GRN received
        <b className="text-stone-900 tabular-nums">{poDoneGrnReceived}</b>
      </span>
      <span className="text-stone-400 ml-auto">{total} total indents</span>
    </div>
  )
}
