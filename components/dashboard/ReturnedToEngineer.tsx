import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { formatINR, formatDate } from '@/lib/utils'
import { RETURNED_STALE_DAYS, type ReturnedItem } from '@/lib/cost-control/returned-to-engineer'
import { Undo2, Clock } from 'lucide-react'

/** "Returned — waiting on the engineer".
 *
 *  Sits BELOW "Needs you now" and is visually quieter on purpose: nothing here
 *  is the approver's to do. It is a chasing list, so it carries the three things
 *  you would otherwise open each sheet to find — who is holding it, how long,
 *  and what you asked him to change. Self-hides when there is nothing. */
export function ReturnedToEngineer({ items }: { items: ReturnedItem[] }) {
  if (items.length === 0) return null

  const stale = items.filter(i => i.days >= RETURNED_STALE_DAYS)
  const total = items.reduce((s, i) => s + i.amount, 0)

  return (
    <Card className="p-0 shadow-sm overflow-hidden border-l-4 border-amber-300">
      <div className="px-4 py-2.5 border-b border-slate-100 bg-amber-50/50 flex items-center gap-2 flex-wrap">
        <h3 className="font-bold text-slate-800 text-sm inline-flex items-center gap-1.5">
          <Undo2 className="h-4 w-4 text-amber-600" />
          Returned — waiting on the engineer · {items.length}
        </h3>
        <span className="ml-auto text-[11px] text-slate-500">
          {formatINR(total)} held up
          {stale.length > 0 && (
            <span className="text-rose-600 font-bold"> · {stale.length} over {RETURNED_STALE_DAYS} days</span>
          )}
        </span>
      </div>

      <div className="divide-y divide-slate-50">
        {items.map(i => {
          const isStale = i.days >= RETURNED_STALE_DAYS
          return (
            <Link key={i.id} href={i.url} className="block px-4 py-2.5 hover:bg-slate-50/70 transition">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="font-semibold text-slate-800 text-[13px]">{i.work}</span>
                <span className="text-[11px] text-slate-500 font-mono">{i.projectCode ?? i.wsCode}</span>
                <span
                  className={`text-[10px] font-extrabold rounded-full px-2 py-0.5 inline-flex items-center gap-1 ${
                    isStale ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <Clock className="h-2.5 w-2.5" />
                  {i.days}d
                </span>
                <span className="ml-auto tabular-nums font-bold text-slate-700 text-[13px]">
                  {formatINR(i.amount)}
                </span>
              </div>

              <div className="text-[11.5px] text-slate-500 mt-0.5">
                with <b className="text-slate-700">{i.engineer ?? 'the engineer'}</b>
                {i.returnedBy && <> · returned by {i.returnedBy}</>}
                {i.returnedAt && <> on {formatDate(i.returnedAt)}</>}
                {!i.returnedAt && <> · no return event recorded</>}
              </div>

              {i.comment && (
                <p className="text-[11.5px] text-slate-600 mt-1 pl-2 border-l-2 border-slate-200 italic line-clamp-2">
                  &ldquo;{i.comment}&rdquo;
                </p>
              )}
            </Link>
          )
        })}
      </div>

      <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-50">
        These are not yours to approve — they are with the engineer. Shown so the loop gets closed.
        A returned sheet disappears from here once it is resubmitted, or once a replacement is approved.
      </p>
    </Card>
  )
}
