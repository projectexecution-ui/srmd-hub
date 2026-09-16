import Link from 'next/link'
import { UserRound, UserPlus } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import type { DeskHold, HoldSummary } from '@/lib/bills-booking/holding'

/** Pending bills, by the desk holding them.
 *
 *  Aksha, 15 Sep 2026: "better keep my Approvals and Pending Bills to be on
 *  More concenrated … which can track the Bills and respective Heads can push
 *  the same." Then, on the first cut of this: "this looks very un professional."
 *
 *  He was right. What was wrong with it, and the rule taken from each:
 *
 *    "34.427370196759256d"   — days came straight out of a fractional SLA
 *                              clock. Rounded at the source now.
 *    "3 bills  ₹12  34.4d/3" — three unrelated figures run together with no
 *                              separator. Money and age are now a right-hand
 *                              column, stacked, tabular, aligned down the page.
 *    "₹0" on a desk holding   — the desk held ₹12 L of walkthrough bills and no
 *    a ₹12,37,653 bill          real ones. A zero next to a big number reads as
 *                              broken. Real money and example bills are now
 *                              counted apart and each is only shown when it
 *                              exists.
 *    three identical red       — the same sentence repeated on every desk with
 *    banners                     nobody on it. Said once, at the top.
 *    a black "—" chip          — a project chip for a bill that has no project.
 *                              Now it just is not drawn.
 *
 *  Colour means one thing each: amber is a desk nobody is on (a setup gap,
 *  fixable in a minute), rose is past its SLA (a delay, someone's to answer
 *  for). Nothing else is coloured, so both still register. */
export function WhoHolds({ desks, summary }: { desks: DeskHold[]; summary: HoldSummary }) {
  if (desks.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
        <b className="text-gray-900">Nothing is waiting.</b> Every bill entered has been paid or closed.
      </div>
    )
  }

  const deskCount = desks.length

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 className="text-sm font-bold text-gray-900">Pending bills — who holds what</h2>
        {/* Deliberately NOT a second copy of the KPI tiles above: live count,
            money and over-SLA are already there, and printing them twice a
            centimetre apart is how a screen stops being read. Only what the
            tiles cannot say. */}
        <p className="text-[11px] text-gray-500">
          {deskCount} {deskCount === 1 ? 'desk' : 'desks'}
          {summary.mine > 0 && <> · <span className="font-semibold text-indigo-700">{summary.mine} yours</span></>}
          {summary.examples > 0 && <> · {summary.examples} example</>}
        </p>
      </div>

      {/* Said once, not on every card. */}
      {summary.orphanDesks > 0 && (
        <p className="mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <UserPlus className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <span>
            <b>{summary.orphanDesks} {summary.orphanDesks === 1 ? 'desk has' : 'desks have'} nobody assigned.</b>{' '}
            Bills stop there until somebody is named.
          </span>
          <Link href="/bills-booking/admin" className="font-semibold text-amber-900 underline underline-offset-2">
            Assign in Desks
          </Link>
        </p>
      )}

      <div className="space-y-2">
        {desks.map(d => (
          // The card takes the colour of its worst bill: amber past the desk's
          // turnaround, rose past double it. Aksha, 16 Sep 2026, screen A —
          // "who is holding things up" answered by looking, not asking.
          <div key={d.stage} className={`overflow-hidden rounded-xl border bg-white ${
            d.tone === 'late' ? 'border-rose-300 ring-1 ring-rose-200'
              : d.tone === 'warn' ? 'border-amber-300'
                : 'border-gray-200'}`}>
            {/* Who has to act, and how much is sitting with them */}
            <div className={`flex items-start gap-3 border-b px-3 py-2 ${
              d.tone === 'late' ? 'border-rose-100 bg-rose-50/50'
                : d.tone === 'warn' ? 'border-amber-100 bg-amber-50/50'
                  : 'border-gray-100 bg-gray-50/70'}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[13px] font-bold text-gray-900">{d.label}</span>
                  {d.mine && (
                    <span className="rounded-full bg-indigo-600 px-1.5 py-px text-[10px] font-bold text-white">yours</span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-[11px]">
                  {d.orphan ? (
                    <span className="font-semibold text-amber-700">Nobody assigned</span>
                  ) : (
                    <>
                      <UserRound className="h-3 w-3 shrink-0 text-gray-400" />
                      <span className="truncate text-gray-600">{d.holders.join(', ')}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[13px] font-bold tabular-nums text-gray-900">
                  {d.value > 0 ? formatINR(d.value) : <span className="font-medium text-gray-400">example only</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-gray-500">
                  {billCount(d)} · longest{' '}
                  <span className={d.lateCount ? 'font-semibold text-rose-600' : ''}>{d.oldestDays}d</span>
                  {d.slaDays != null && <span className="text-gray-400"> of {d.slaDays}</span>}
                </div>
              </div>
            </div>

            <ul className="divide-y divide-gray-100">
              {d.bills.map(b => (
                <li key={b.id}>
                  <Link href={`/bills-booking/${b.id}`}
                        className="flex min-h-[44px] items-center gap-3 px-3 py-2 hover:bg-indigo-50/40">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-gray-900">{b.vendor}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        <span className="text-[10.5px] font-medium text-gray-400">{b.orderType}</span>
                        {/* Not every bill has a CT Hub project: 32 of the 54 IN4
                            sub-projects carrying work orders have none. A chip
                            reading "—" said nothing, so it is not drawn. */}
                        {b.projectLabel && (
                          <span className="rounded bg-slate-700 px-1.5 py-px text-[10px] font-semibold text-white">
                            {b.projectLabel}
                          </span>
                        )}
                        {b.isExample && (
                          <span className="rounded border border-gray-200 px-1.5 py-px text-[10px] font-semibold text-gray-500">
                            example
                          </span>
                        )}
                        {b.flag === 'amendment' && (
                          <span className="rounded bg-rose-100 px-1.5 py-px text-[10px] font-semibold text-rose-700">
                            IN4 amendment
                          </span>
                        )}
                        {b.flag === 'no_wo' && (
                          <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800">
                            no WO
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-bold tabular-nums text-gray-900">{formatINR(b.amount)}</span>
                      <span className={`mt-0.5 block text-[11px] tabular-nums ${
                        b.late ? 'font-semibold text-rose-600' : 'text-gray-400'}`}>
                        {b.days === 0 ? 'today' : `${b.days}d`}
                      </span>
                    </span>
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

/** "2 bills", "2 bills + 3 example", "3 example" — never "0". */
function billCount(d: DeskHold): string {
  const live = d.liveCount ? `${d.liveCount} ${d.liveCount === 1 ? 'bill' : 'bills'}` : ''
  const ex = d.exampleCount ? `${d.exampleCount} example` : ''
  if (live && ex) return `${live} + ${ex}`
  return live || ex
}
