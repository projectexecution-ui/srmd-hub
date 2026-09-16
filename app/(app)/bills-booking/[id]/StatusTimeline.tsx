import { Card } from '@/components/ui/card'
import { stageDef } from '@/lib/bills-booking/stages'
import type { TimelineSeg } from '@/lib/bills-booking/timeline'

const fmtDays = (d: number) => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(d < 10 ? 1 : 0)}d`)

/** How the bill got here — who held it, for how long, and what they said.
 *
 *  Aksha, 16 Sep 2026, screen B: the timeline names the person and the days at
 *  each desk, and puts the send-back reason where it happened, not in a
 *  separate log three cards down. A desk nobody moved it off — IN4 did, or the
 *  bill raised itself — says so, because "moved by nobody" is a fact worth
 *  reading on a money trail. */
export function StatusTimeline({ segs, holders, meOnDesk }: {
  segs: TimelineSeg[]
  /** Who is on the desk holding it now. */
  holders: string[]
  meOnDesk: boolean
}) {
  if (segs.length === 0) return null
  const total = segs.reduce((a, s) => a + s.days, 0)
  const breaches = segs.filter(s => s.breached).length

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Flow — who held it, for how long</p>
        <p className="text-xs text-gray-500">
          {fmtDays(total)} total{breaches > 0 && <span className="ml-1 font-semibold text-rose-600">· {breaches} over SLA</span>}
        </p>
      </div>
      <ol className="relative ml-1.5 space-y-3 border-l-2 border-gray-200 pl-4">
        {segs.map((s, i) => {
          const d = stageDef(s.stage)
          const dot = s.current ? 'bg-indigo-600 ring-4 ring-indigo-500/20'
            : s.leftAction === 'send_back' ? 'bg-amber-500'
              : s.breached ? 'bg-rose-500' : 'bg-emerald-500'
          const left = s.current ? null
            : s.leftAction === 'send_back' ? 'sent back'
              : s.leftAction === 'undo' ? 'pulled back'
                : s.leftAction === 'hold' ? 'put on hold'
                  : s.leftAction === 'reject' ? 'rejected'
                    : s.leftAction === 'resume' ? 'resumed'
                      : 'forwarded'
          return (
            <li key={i} className="relative text-[13px]">
              <span className={`absolute -left-[23px] top-1.5 h-3 w-3 rounded-full ring-2 ring-white ${dot}`} />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <b className="text-gray-900">{d.label}</b>
                {s.current ? (
                  <span className="text-gray-600">
                    {holders.length ? holders.join(', ') : <span className="text-amber-700">nobody assigned</span>}
                    {meOnDesk && <span className="ml-1.5 rounded bg-indigo-600 px-1.5 py-px text-[10px] font-bold text-white">you</span>}
                  </span>
                ) : (
                  <span className="text-gray-600">{s.automatic ? 'IN4' : (s.movedBy ?? 'someone')}</span>
                )}
                <span className={`tabular-nums ${s.breached ? 'font-semibold text-rose-600' : 'text-gray-500'}`}>
                  · {fmtDays(s.days)}{s.current ? ' so far' : ''}
                  {s.sla != null && <span className="text-gray-400"> of {s.sla}d</span>}
                </span>
                {left && <span className="text-gray-400">· {left}</span>}
              </div>
              {s.leftComment && (
                <div className={`mt-1 rounded-lg border px-3 py-1.5 text-[12px] ${
                  s.leftAction === 'send_back' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-gray-50 text-gray-600'}`}>
                  {s.leftAction === 'send_back' && <b>Reason: </b>}{s.leftComment}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
