// "Budget shifting — where each request is". For Parimal (Coordinator), the
// Atm Heads and Admin (Aksha, 10 Oct 2026): every open request, the step it is
// on, who has it, and how long it has waited there — so a stuck one is seen
// and chased. Text lines only, the same lines on every row, so it reads the
// same on a phone (no bars, no chip rows).

import Link from 'next/link'
import { ArrowLeftRight, ArrowRight, TriangleAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatINR, formatDateTime } from '@/lib/utils'
import { waitedLabel, TRANSFER_STEPS, type TrackerRow } from '@/lib/cost-control/transfer-tracker'

export function TransferTrackerSection({
  rows, title = 'Budget shifting — where each request is', error,
}: {
  rows: TrackerRow[]
  title?: string
  error?: string
}) {
  if (error) {
    return (
      <Card className="p-4 text-sm text-rose-800 bg-rose-50 border-rose-200">
        Could not load the budget shifting requests: {error}
      </Card>
    )
  }
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const stuck = rows.filter(r => r.stuck).length

  return (
    <Card className="p-0 overflow-hidden border-l-4 border-l-indigo-300">
      <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70">
        <p className="text-sm font-bold text-gray-900 inline-flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-indigo-600" />
          {title}
        </p>
        <p className="text-xs text-gray-600 mt-0.5 tabular-nums">
          {rows.length} open · {formatINR(total)}
          {stuck > 0 && <span className="text-rose-700 font-semibold"> · {stuck} waiting 2 days or more</span>}
        </p>
      </div>

      <div className="divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.id} className="px-4 py-3.5 space-y-1">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <Link href={`/cost-control/projects/${r.projectId}`} className="text-[13px] font-semibold text-blue-700 hover:underline">
                {r.projectLabel}
              </Link>
              <span className="text-[14px] font-bold tabular-nums text-gray-900">{formatINR(r.amount)}</span>
            </div>

            <p className="text-[12.5px] text-gray-900 break-words">
              <span className="text-gray-500">{r.fromLabel}</span>
              <ArrowLeftRight className="inline h-3 w-3 mx-1.5 text-indigo-500 align-middle" />
              <b>{r.toLabel}</b>
            </p>

            {/* Where it is — the line this whole block exists for. */}
            <p className="text-[12.5px] text-gray-800">
              <span className="text-gray-500">Step {r.step} of {TRANSFER_STEPS} · </span>
              <b>With {r.stage === 'IN4 sync check' ? r.withWhom : `${r.stage}: ${r.withWhom}`}</b>
              <span className={r.stuck ? 'text-rose-700 font-semibold' : 'text-gray-500'}>
                {' '}· {waitedLabel(r)}{r.since ? ` (since ${formatDateTime(r.since)})` : ''}
              </span>
            </p>

            <p className="text-[11.5px] text-gray-500">
              Raised by {r.raisedBy ?? '—'}
              {r.next.length > 0 && <> · then {r.next.join(' → ')}</>}
            </p>

            {r.settleNote && (
              <p className="text-[11.5px] text-rose-800 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 inline-flex items-start gap-1.5">
                <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
                <span>{r.settleNote}</span>
              </p>
            )}

            {r.mine && r.actionHref && (
              <Link href={r.actionHref} className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700 hover:underline min-h-[32px]">
                Waiting on you — {r.status === 'awaiting_in4' ? 'record "Budget shifted in IN4"' : 'approve or turn down'} <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
