import { Card } from '@/components/ui/card'
import { stageDef } from '@/lib/bills-booking/stages'
import type { TimelineSeg } from '@/lib/bills-booking/timeline'
import { formatDate, formatINR } from '@/lib/utils'

const fmtDays = (d: number) => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(d < 10 ? 1 : 0)}d`)

/** How the bill got here. One line per desk, and nothing else.
 *
 *  Aksha, 17 Sep 2026: "why showing so much info - its looking like garbage."
 *  He was right, and it was three separate faults:
 *
 *  · The page carried BOTH this card and a "History" card built from the same
 *    six events. Same facts, twice, in two shapes. History is gone; this is
 *    the trail.
 *  · Every routine "forwarded" comment got its own boxed paragraph — five grey
 *    boxes saying things like "Entered against the order". A comment is now
 *    only drawn when it is a DECISION: sent back, held, rejected, pulled back.
 *    The routine ones sit in the row's tooltip, where they cost nothing.
 *  · The same rupee figure was printed against all six desks. It is shown only
 *    where it CHANGED — which is the one thing worth seeing on a money trail.
 *
 *  What survives is who held it, for how long, whether that was late, and what
 *  they said when it mattered. */
export function StatusTimeline({ segs, holders, meOnDesk }: {
  segs: TimelineSeg[]
  holders: string[]
  meOnDesk: boolean
}) {
  if (segs.length === 0) return null
  const total = segs.reduce((a, s) => a + s.days, 0)
  const breaches = segs.filter(s => s.breached).length
  const decision = (a: string | null) => a === 'send_back' || a === 'hold' || a === 'reject' || a === 'undo'

  let shownAmount: number | null = null

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Flow</p>
        <p className="text-xs text-gray-500">
          {fmtDays(total)} total{breaches > 0 && <span className="ml-1 font-semibold text-rose-600">· {breaches} over SLA</span>}
        </p>
      </div>

      <ol className="relative ml-1.5 space-y-1.5 border-l-2 border-gray-200 pl-4">
        {segs.map((s, i) => {
          const d = stageDef(s.stage)
          const dot = s.current ? 'bg-indigo-600 ring-4 ring-indigo-500/20'
            : s.leftAction === 'send_back' ? 'bg-amber-500'
              : s.leftAction === 'reject' ? 'bg-rose-500'
                : s.breached ? 'bg-rose-400' : 'bg-emerald-500'
          // The figure, only where it moved.
          const amt = s.leftAmount != null && s.leftAmount !== shownAmount ? s.leftAmount : null
          if (s.leftAmount != null) shownAmount = s.leftAmount
          const verb = s.leftAction === 'send_back' ? 'sent back'
            : s.leftAction === 'undo' ? 'pulled back'
              : s.leftAction === 'hold' ? 'held'
                : s.leftAction === 'reject' ? 'rejected' : null
          return (
            <li key={i} className="relative">
              <span className={`absolute -left-[23px] top-[7px] h-2.5 w-2.5 rounded-full ring-2 ring-white ${dot}`} />
              <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]"
                   title={s.leftComment && !decision(s.leftAction) ? s.leftComment : undefined}>
                <b className="text-gray-900">{d.label}</b>
                <span className="text-gray-500">
                  {s.current
                    ? (holders.length ? holders.join(', ') : <span className="text-amber-700">nobody assigned</span>)
                    : (s.automatic ? 'IN4' : (s.movedBy ?? 'someone'))}
                </span>
                {meOnDesk && s.current && <span className="rounded bg-indigo-600 px-1.5 py-px text-[10px] font-bold text-white">you</span>}
                <span className={`tabular-nums ${s.breached ? 'font-semibold text-rose-600' : 'text-gray-400'}`}>
                  {fmtDays(s.days)}{s.current ? ' so far' : ''}{s.sla != null ? ` / ${s.sla}d` : ''}
                </span>
                {verb && <span className="font-medium text-amber-700">{verb}</span>}
                {amt != null && <span className="tabular-nums text-gray-600">{formatINR(amt)}</span>}
                {s.leftAt && <span className="ml-auto text-[11px] text-gray-400">{formatDate(s.leftAt)}</span>}
              </div>
              {/* Only a decision gets the reason drawn out. */}
              {s.leftComment && decision(s.leftAction) && (
                <p className={`mt-1 rounded-lg border px-2.5 py-1 text-[12px] ${
                  s.leftAction === 'reject' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                  {s.leftComment}
                </p>
              )}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
