// At-a-glance health of the scheduled-jobs dispatcher. The dispatcher stamps
// app_settings.cron_heartbeat_am / _pm on each run; if a slot hasn't fired in
// over a day this goes red, so a skipped Vercel cron is never silent.

import { Clock, CheckCircle2, AlertTriangle } from 'lucide-react'

const STALE_HOURS = 26 // one full cycle + a margin

function fmtIST(iso: string | null): string {
  if (!iso) return 'never'
  try {
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })
  } catch { return iso }
}

function hoursSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (nowMs - t) / 3_600_000
}

export function CronHealthStrip({ amAt, pmAt, nowMs }: { amAt: string | null; pmAt: string | null; nowMs: number }) {
  const rows = [
    { label: 'Morning batch', time: '09:00 IST', at: amAt },
    { label: 'Afternoon batch', time: '15:00 IST', at: pmAt },
  ]
  const anyStale = rows.some(r => { const h = hoursSince(r.at, nowMs); return h === null || h > STALE_HOURS })

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6">
      <div className={`rounded-2xl border p-4 ${anyStale ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50/60'}`}>
        <div className="flex items-center gap-2 mb-2.5">
          <Clock className={`h-4 w-4 ${anyStale ? 'text-rose-600' : 'text-emerald-600'}`} />
          <h3 className="text-sm font-bold text-gray-900">Scheduled jobs</h3>
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${anyStale ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {anyStale ? 'Needs attention' : 'Running'}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map(r => {
            const h = hoursSince(r.at, nowMs)
            const bad = h === null || h > STALE_HOURS
            const ago = h === null ? '' : h < 1 ? ' (under an hour ago)' : ` (${Math.round(h)}h ago)`
            return (
              <div key={r.label} className="flex items-center gap-2 rounded-xl bg-white border border-gray-100 px-3 py-2">
                {bad ? <AlertTriangle className="h-4 w-4 text-rose-500 flex-shrink-0" /> : <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />}
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-gray-800">{r.label} <span className="text-gray-400 font-normal">· {r.time}</span></div>
                  <div className={`text-[11px] ${bad ? 'text-rose-600' : 'text-gray-500'}`}>Last ran: {fmtIST(r.at)}{ago}</div>
                </div>
              </div>
            )
          })}
        </div>
        {anyStale ? (
          <p className="mt-2.5 text-[12px] text-rose-700 leading-relaxed">
            A batch hasn&rsquo;t run in over a day. Jobs self-heal at the next slot, but if this stays red: confirm <b>CRON_SECRET</b> is set on Vercel (Production) and the Vercel <b>Crons</b> tab shows recent runs.
          </p>
        ) : (
          <p className="mt-2.5 text-[12px] text-gray-500 leading-relaxed">
            Each daily job is attempted at both slots and runs once per day — so a skipped 9 AM run is caught up at 3 PM automatically.
          </p>
        )}
      </div>
    </div>
  )
}
