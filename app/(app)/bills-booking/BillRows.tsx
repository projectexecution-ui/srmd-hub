import Link from 'next/link'
import { StagePill } from './StagePill'
import { formatINR } from '@/lib/utils'
import { ageTone, daysAtStage, type AgeTone } from '@/lib/bills-booking/stages'
import { tagsFor, whyHere, type RegisterRow, type Tag } from '@/lib/bills-booking/register'

/** The register's rows, as a desk reads them.
 *
 *  Aksha, 16 Sep 2026, screen A. Every row carries: who, where it is, what is
 *  wrong with it (as tags), the order · RA · project · bill number line, ONE
 *  line saying why it is on your desk, the money, and its age coloured by the
 *  desk's own turnaround. So the register is read, not opened row by row.
 *
 *  One layout for phone and laptop: the row wraps, the money and age stay on
 *  the right, and the whole row is one ≥44px tap. */
const TAG: Record<Tag, { label: string; cls: string; title: string }> = {
  arrived:         { label: 'arrived from IN4',     cls: 'border-emerald-200 bg-emerald-50 text-emerald-700', title: 'Raised by itself when IN4 approved the abstract — nobody typed it' },
  stamped_missing: { label: 'stamped bill missing', cls: 'border-rose-200 bg-rose-50 text-rose-700',          title: 'The Disc Head cannot forward this until the stamped bill is attached' },
  duplicate:       { label: 'possible duplicate',   cls: 'border-amber-300 bg-amber-50 text-amber-800',       title: 'The same bill number is already booked on this order — check before forwarding' },
  sent_back:       { label: 'sent back',            cls: 'border-amber-200 bg-amber-50 text-amber-800',       title: 'Returned with a reason — see the line below' },
  example:         { label: 'example',              cls: 'border-gray-200 bg-white text-gray-500',            title: 'A worked example — real order, no real money' },
}

const AGE: Record<AgeTone, string> = {
  ok:   'bg-emerald-50 text-emerald-700',
  warn: 'bg-amber-50 text-amber-800',
  late: 'bg-rose-50 text-rose-700',
  none: 'bg-gray-50 text-gray-500',
}

export function BillRows({ rows, dupes, title, note }: {
  rows: RegisterRow[]
  dupes: Set<string>
  title: string
  note?: string
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-2">
        <p className="text-[13px] font-bold text-gray-900">{title}</p>
        <p className="text-[11px] text-gray-500">{rows.length} {rows.length === 1 ? 'bill' : 'bills'}{note ? ` · ${note}` : ''}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-gray-500">Nothing matches. Clear a filter, or pick another view.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map(r => {
            const tags = tagsFor(r, dupes)
            const why = whyHere(r)
            const days = Math.round(daysAtStage(r.stageSince))
            const tone = ageTone(r.stage, r.stageSince)
            return (
              <li key={r.id}>
                <Link href={`/bills-booking/${r.id}`}
                      className="flex min-h-[44px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-gray-50/60">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-gray-900">{r.vendor}</span>
                      <StagePill stage={r.stage} />
                      {tags.map(t => (
                        <span key={t} title={TAG[t].title}
                              className={`rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${TAG[t].cls}`}>
                          {TAG[t].label}
                        </span>
                      ))}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-500">
                      {r.orderNo ?? r.orderType}{r.project ? ` · ${r.project}` : ''}{r.billNo ? ` · ${r.billNo}` : ''}
                    </div>
                    {why && <div className="mt-1 text-[11.5px] text-gray-600">{why}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums text-gray-900">{formatINR(r.amount)}</div>
                    <div className="text-[10.5px] text-gray-400">{r.orderType === 'PO' ? 'gross' : 'claimed'}</div>
                  </div>
                  <span className={`rounded-md px-2 py-1 text-[11px] font-bold tabular-nums ${AGE[tone]}`}
                        title={tone === 'late' ? 'Past twice the desk turnaround' : tone === 'warn' ? 'Past the desk turnaround' : tone === 'ok' ? 'Within turnaround' : 'Followed, not held here'}>
                    {days === 0 ? 'today' : `${days}d`}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
