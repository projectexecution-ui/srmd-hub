import Link from 'next/link'
import { AlertTriangle, UserRound, UserX } from 'lucide-react'
import { formatINR, formatINRCompact } from '@/lib/utils'
import type { DeskHold, HoldSummary } from '@/lib/bills-booking/holding'

/** Pending bills, by the desk holding them.
 *
 *  Aksha, 15 Sep 2026: "better keep my Approvals and Pending Bills to be on
 *  More concenrated … which can track the Bills and respective Heads can push
 *  the same."
 *
 *  So: one list, not eight tiles. Every bill still moving, under the desk that
 *  has it, with that desk's people named — because "push it" needs a name, and
 *  the page could not previously say one. The desk sitting longest is first.
 *
 *  A desk with nobody on it gets a red header rather than a quiet empty space:
 *  a bill with no owner is the only thing here that cannot fix itself. */
export function WhoHolds({ desks, summary }: { desks: DeskHold[]; summary: HoldSummary }) {
  if (desks.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
        <b>Nothing is waiting.</b> Every bill entered has been paid or closed.
      </div>
    )
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-bold text-gray-900">
          Pending bills — who holds what
        </h2>
        <p className="text-[11px] text-gray-500">
          {summary.bills} moving · {formatINR(summary.value)}
          {summary.late > 0 && <span className="text-rose-600 font-semibold"> · {summary.late} over SLA</span>}
          {summary.orphaned > 0 && <span className="text-rose-700 font-semibold"> · {summary.orphaned} with no one</span>}
          {summary.mine > 0 && <span className="text-indigo-700 font-semibold"> · {summary.mine} on your desk</span>}
        </p>
      </div>

      <div className="space-y-2.5">
        {desks.map(d => (
          <div key={d.stage}
               className={`overflow-hidden rounded-xl border ${
                 d.orphan ? 'border-rose-200' : d.mine ? 'border-indigo-200' : 'border-gray-200'}`}>
            {/* Who has to act */}
            <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 ${
              d.orphan ? 'bg-rose-50' : d.mine ? 'bg-indigo-50' : 'bg-gray-50'}`}>
              <span className="text-[13px] font-bold text-gray-900">{d.label}</span>
              {d.mine && (
                <span className="rounded-full bg-indigo-600 px-1.5 py-px text-[10px] font-bold text-white">
                  yours
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[11px]">
                {d.orphan ? (
                  <><UserX className="h-3.5 w-3.5 text-rose-600" />
                    <b className="text-rose-700">nobody is on this desk</b></>
                ) : (
                  <><UserRound className="h-3.5 w-3.5 text-gray-400" />
                    <span className="text-gray-600">{d.holders.join(', ')}</span></>
                )}
              </span>
              <span className="ml-auto flex items-center gap-2 text-[11px] text-gray-500">
                <span>{d.bills.length} {d.bills.length === 1 ? 'bill' : 'bills'}</span>
                <span className="tabular-nums font-semibold text-gray-700">{formatINRCompact(d.value)}</span>
                <span className={`tabular-nums ${d.lateCount ? 'font-semibold text-rose-600' : ''}`}>
                  {d.oldestDays}d{d.slaDays ? ` / ${d.slaDays}` : ''}
                </span>
              </span>
            </div>

            {d.orphan && (
              <p className="border-b border-rose-100 bg-rose-50/50 px-3 py-1.5 text-[11px] text-rose-800">
                These cannot move until somebody is put on this desk. <Link href="/bills-booking/admin" className="font-semibold underline">Set it in Desks</Link>.
              </p>
            )}

            <ul className="divide-y divide-gray-100 bg-white">
              {d.bills.map(b => (
                <li key={b.id}>
                  <Link href={`/bills-booking/${b.id}`}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 hover:bg-indigo-50/50 min-h-[44px]">
                    <span className="truncate text-[13px] font-semibold text-gray-900">{b.vendor}</span>
                    <span className="rounded bg-slate-800 px-1.5 py-px text-[10px] font-bold text-white">{b.projectLabel}</span>
                    {b.isExample && (
                      <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800">EXAMPLE</span>
                    )}
                    {b.flag === 'amendment' && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-px text-[10px] font-bold text-rose-700">
                        <AlertTriangle className="h-2.5 w-2.5" /> IN4 amendment
                      </span>
                    )}
                    {b.flag === 'no_wo' && (
                      <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold text-amber-800">No WO</span>
                    )}
                    <span className={`ml-auto text-[11px] tabular-nums ${
                      b.late ? 'font-semibold text-rose-600' : 'text-gray-400'}`}>
                      {b.days}d
                    </span>
                    <span className="text-[13px] font-bold tabular-nums text-gray-900">{formatINR(b.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
