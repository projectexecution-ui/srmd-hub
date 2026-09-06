// Budget transfers waiting on the person reading this page.
//
// These sit in the SAME inbox as working sheets on purpose. A second approvals
// screen is what produced "You're all caught up" in the app while Telegram and
// email said two things were pending — the counts have to come from one place
// or they will disagree again.
//
// A transfer is not a working sheet: no money is being approved, budget is
// being moved between two categories that were each approved separately. So it
// reads as its own block rather than being squeezed into a sheet card.

import Link from 'next/link'
import { ArrowLeftRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { formatINR, formatDate } from '@/lib/utils'
import { TransferDecideActions } from './TransferDecideActions'

export interface TransferInboxRow {
  id: string
  project_id: string
  project_code: string | null
  project_name: string | null
  status: string
  stage: string
  amount: number
  reason: string
  from_label: string
  to_label: string
  raised_at: string | null
  raised_by_name: string | null
  atm_by_name: string | null
  atm_comment: string | null
}

export function TransferInboxSection({ rows }: { rows: TransferInboxRow[] }) {
  if (rows.length === 0) return null

  const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0)

  return (
    <Card className="p-0 overflow-hidden border-l-4 border-l-indigo-500">
      <div className="px-4 py-3 border-b border-gray-100 bg-indigo-50/40">
        <p className="text-sm font-bold text-gray-900 inline-flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-indigo-600" />
          {rows.length} budget transfer{rows.length === 1 ? '' : 's'} waiting on you
        </p>
        <p className="text-xs text-gray-600 mt-0.5">
          {formatINR(total)} to move between work categories. Approving does not move any
          money — only IN4 does that, once this is signed.
        </p>
      </div>

      <div className="divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.id} className="px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <Link
                href={`/cost-control/projects/${r.project_id}`}
                className="text-[13px] font-semibold text-blue-700 hover:underline"
              >
                {r.project_code ?? r.project_name ?? 'Project'}
              </Link>
              <span className="text-[14px] font-bold tabular-nums text-gray-900">
                {formatINR(Number(r.amount ?? 0))}
              </span>
            </div>

            {/* The movement, in the same naming the project screen uses. */}
            <p className="mt-1.5 text-[12.5px] text-gray-900">
              <span className="text-gray-500">{r.from_label}</span>
              <ArrowLeftRight className="inline h-3 w-3 mx-1.5 text-indigo-500 align-middle" />
              <b>{r.to_label}</b>
            </p>

            <p className="mt-1 text-[12px] text-gray-700 whitespace-pre-line">{r.reason}</p>

            <p className="mt-1.5 text-[11px] text-gray-500">
              Raised by {r.raised_by_name ?? '—'}
              {r.raised_at && <> · {formatDate(r.raised_at)}</>}
              {r.atm_by_name && <> · Atm Head {r.atm_by_name} has signed it</>}
            </p>
            {r.atm_comment && (
              <p className="mt-1 text-[11.5px] text-gray-600 italic">{r.atm_comment}</p>
            )}

            <div className="mt-2.5">
              <TransferDecideActions
                id={r.id}
                projectId={r.project_id}
                amount={Number(r.amount ?? 0)}
                stage={r.stage}
                fromLabel={r.from_label}
                toLabel={r.to_label}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
