import { Card } from '@/components/ui/card'
import { stageDef } from '@/lib/bills-booking/stages'
import type { TimelineSeg } from '@/lib/bills-booking/timeline'

const fmtDays = (d: number) => (d < 1 ? `${Math.round(d * 24)}h` : `${d.toFixed(d < 10 ? 1 : 0)}d`)

export function StatusTimeline({ segs }: { segs: TimelineSeg[] }) {
  if (segs.length === 0) return null
  const total = segs.reduce((a, s) => a + s.days, 0)
  const breaches = segs.filter(s => s.breached).length

  return (
    <Card className="p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-400">Time at each desk</p>
        <p className="text-xs text-gray-500">
          {fmtDays(total)} total{breaches > 0 && <span className="ml-1 font-semibold text-rose-600">· {breaches} over SLA</span>}
        </p>
      </div>
      <ol className="space-y-1.5">
        {segs.map((s, i) => {
          const d = stageDef(s.stage)
          return (
            <li key={i} className="flex items-center gap-3">
              <span className={`h-2 w-2 shrink-0 rounded-full ${s.current ? 'bg-indigo-500 ring-4 ring-indigo-500/20' : s.breached ? 'bg-rose-500' : 'bg-gray-300'}`} />
              <span className="w-28 shrink-0 truncate text-sm font-medium text-gray-800">{d.label}</span>
              <span className={`text-sm font-bold tabular-nums ${s.breached ? 'text-rose-600' : s.current ? 'text-indigo-700' : 'text-gray-700'}`}>
                {fmtDays(s.days)}{s.current && ' · here now'}
              </span>
              {s.sla != null && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.breached ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {s.breached ? `over ${s.sla}d SLA` : `within ${s.sla}d`}
                </span>
              )}
              {s.movedBy && <span className="ml-auto truncate text-[11px] text-gray-400">moved by {s.movedBy}</span>}
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
