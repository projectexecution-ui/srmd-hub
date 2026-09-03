// "Budget to move between categories in IN4" — the third list the ERP person
// works from, beside the sheet-entry queue and the budget reductions.
//
// An approved cross-category transfer changes nothing until somebody makes the
// move in IN4 by hand. Rather than expecting them to open every project
// looking for one, the approved requests collect here.
//
// Ones already ticked stay on the list until a sync has actually matched both
// lines. That is deliberate: a transfer ticked as done but never really made
// would otherwise disappear the moment it was claimed.
//
// Read through cc_transfer_in4_queue(), gated to the same two roles as this
// page, so it works for a Coordinator with no project membership.

import Link from 'next/link'
import { ArrowLeftRight, TriangleAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { createClient } from '@/lib/supabase/server'
import { formatINR, formatDate } from '@/lib/utils'
import { MarkTransferMovedButton } from './MarkTransferMovedButton'

interface QueueRow {
  id: string
  project_id: string
  project_code: string | null
  project_name: string | null
  status: 'awaiting_in4' | 'awaiting_sync'
  amount: number
  reason: string
  from_label: string
  to_label: string
  approved_at: string | null
  trustee_by_name: string | null
  in4_at: string | null
  settle_note: string | null
}

export async function TransferQueue() {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cc_transfer_in4_queue')
  const rows = (data ?? []) as QueueRow[]

  if (error) {
    return <QueryError message={error.message} what="the budget transfer queue" />
  }
  // Nothing outstanding is a good state, not an error.
  if (rows.length === 0) {
    return (
      <Card className="p-4">
        <p className="text-sm font-semibold text-gray-900 inline-flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-indigo-600" /> Budget transfers
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Nothing waiting — every approved transfer between work categories has been made in
          IN4 and matched by a sync.
        </p>
      </Card>
    )
  }

  const todo = rows.filter(r => r.status === 'awaiting_in4')
  const waiting = rows.filter(r => r.status === 'awaiting_sync')
  const todoTotal = todo.reduce((s, r) => s + Number(r.amount ?? 0), 0)

  const Movement = ({ r }: { r: QueueRow }) => (
    <p className="text-[12.5px] text-gray-900">
      <span className="text-gray-500">{r.from_label}</span>
      <ArrowLeftRight className="inline h-3 w-3 mx-1.5 text-indigo-500 align-middle" />
      <b>{r.to_label}</b>
    </p>
  )

  const Mismatch = ({ r }: { r: QueueRow }) =>
    r.settle_note?.startsWith('IN4 does not match') ? (
      <p className="mt-1.5 text-[11.5px] text-rose-800 bg-rose-50 border border-rose-200 rounded px-2 py-1.5 inline-flex items-start gap-1.5">
        <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
        <span>{r.settle_note}</span>
      </p>
    ) : null

  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-bold text-gray-900 inline-flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-indigo-600" /> Budget to move between categories
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {todo.length > 0
            ? <>{todo.length} approved transfer{todo.length === 1 ? '' : 's'} · <b className="text-indigo-800">{formatINR(todoTotal)}</b> to move in IN4, then tick it here.</>
            : <>Nothing new to key in.</>}
          {waiting.length > 0 && <> {waiting.length} already ticked, waiting for a sync to match IN4.</>}
        </p>
      </div>

      {/* Desktop */}
      <div className="overflow-x-auto hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-2 font-semibold">Project</th>
              <th className="px-4 py-2 font-semibold">Move</th>
              <th className="px-4 py-2 font-semibold text-right">Amount</th>
              <th className="px-4 py-2 font-semibold">Approved</th>
              <th className="px-4 py-2 font-semibold text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-2.5 align-top">
                  <Link href={`/cost-control/projects/${r.project_id}`} className="font-semibold text-blue-700 hover:underline">
                    {r.project_code ?? r.project_name ?? '—'}
                  </Link>
                </td>
                <td className="px-4 py-2.5 align-top max-w-[420px]">
                  <Movement r={r} />
                  <p className="mt-1 text-[11.5px] text-gray-600">{r.reason}</p>
                  <Mismatch r={r} />
                </td>
                <td className="px-4 py-2.5 text-right align-top tabular-nums font-bold text-indigo-800">
                  {formatINR(Number(r.amount ?? 0))}
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500 align-top">
                  {r.approved_at ? formatDate(r.approved_at) : '—'}
                  {r.trustee_by_name && <><br />{r.trustee_by_name}</>}
                </td>
                <td className="px-4 py-2.5 text-right align-top">
                  {r.status === 'awaiting_in4' ? (
                    <MarkTransferMovedButton
                      id={r.id}
                      amount={Number(r.amount ?? 0)}
                      fromLabel={r.from_label}
                      toLabel={r.to_label}
                      variant="row"
                    />
                  ) : (
                    <span
                      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-blue-100 text-blue-900 border border-blue-200 whitespace-nowrap"
                      title={r.in4_at ? `Ticked ${formatDate(r.in4_at)} — waiting for a sync to match IN4` : undefined}
                    >
                      Awaiting IN4 proof
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phone — five columns will not survive 375px, so each row is a card. */}
      <div className="md:hidden divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.id} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link href={`/cost-control/projects/${r.project_id}`} className="text-[13px] font-semibold text-blue-700">
                {r.project_code ?? r.project_name ?? '—'}
              </Link>
              <span className="text-[13px] font-bold tabular-nums text-indigo-800 flex-shrink-0">
                {formatINR(Number(r.amount ?? 0))}
              </span>
            </div>
            <div className="mt-1"><Movement r={r} /></div>
            <p className="mt-1 text-[11.5px] text-gray-600">{r.reason}</p>
            <Mismatch r={r} />
            <p className="mt-1 text-[11px] text-gray-400">
              Approved {r.approved_at ? formatDate(r.approved_at) : '—'}
              {r.trustee_by_name && <> by {r.trustee_by_name}</>}
            </p>
            {r.status === 'awaiting_in4' ? (
              <MarkTransferMovedButton
                id={r.id}
                amount={Number(r.amount ?? 0)}
                fromLabel={r.from_label}
                toLabel={r.to_label}
                variant="card"
              />
            ) : (
              <p className="mt-2 text-[11.5px] font-semibold text-blue-800">
                Ticked{r.in4_at && <> {formatDate(r.in4_at)}</>} — waiting for a sync to match IN4.
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}
