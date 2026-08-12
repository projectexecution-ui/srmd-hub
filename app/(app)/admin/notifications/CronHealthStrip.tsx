// At-a-glance health of the scheduled-jobs dispatcher. The dispatcher stamps
// app_settings.cron_heartbeat_am / _pm on each run.
//
// The MORNING batch (09:00 IST) is what matters — it runs every daily job. The
// AFTERNOON batch (15:00 IST) is an optional 2nd pass (retries + a few
// refreshers) and is best-effort on Vercel's free plan, so a blank afternoon is
// NOT an alarm as long as the morning ran. We only go red if the morning batch
// itself hasn't run in over a day — that's the real "nothing ran today" signal.

import { Clock, CheckCircle2, AlertTriangle, MinusCircle } from 'lucide-react'
import { CronRunNowButton } from './CronRunNowButton'

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
  const amH = hoursSince(amAt, nowMs)
  const pmH = hoursSince(pmAt, nowMs)
  const amStale = amH === null || amH > STALE_HOURS      // the morning batch didn't run → real problem
  const pmStale = pmH === null || pmH > STALE_HOURS      // afternoon 2nd pass didn't run → usually fine

  const critical = amStale                                // health hinges on the morning batch only
  const agoText = (h: number | null) => h === null ? '' : h < 1 ? ' (under an hour ago)' : ` (${Math.round(h)}h ago)`

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6">
      <div className={`rounded-2xl border p-4 ${critical ? 'border-rose-200 bg-rose-50' : 'border-emerald-200 bg-emerald-50/60'}`}>
        <div className="flex items-center gap-2 mb-2.5">
          <Clock className={`h-4 w-4 ${critical ? 'text-rose-600' : 'text-emerald-600'}`} />
          <h3 className="text-sm font-bold text-gray-900">Scheduled jobs</h3>
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${critical ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {critical ? 'Needs attention' : 'Running'}
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {/* Morning — the batch that runs everything */}
          <div className="flex items-center gap-2 rounded-xl bg-white border border-gray-100 px-3 py-2">
            {amStale
              ? <AlertTriangle className="h-4 w-4 text-rose-500 flex-shrink-0" />
              : <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />}
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-gray-800">Morning batch <span className="text-gray-400 font-normal">· 09:00 IST · runs everything</span></div>
              <div className={`text-[11px] ${amStale ? 'text-rose-600' : 'text-gray-500'}`}>Last ran: {fmtIST(amAt)}{agoText(amH)}</div>
            </div>
          </div>
          {/* Afternoon — optional 2nd pass; muted (not red) when the morning is healthy */}
          <div className="flex items-center gap-2 rounded-xl bg-white border border-gray-100 px-3 py-2">
            {!pmStale
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
              : critical
                ? <AlertTriangle className="h-4 w-4 text-rose-500 flex-shrink-0" />
                : <MinusCircle className="h-4 w-4 text-gray-300 flex-shrink-0" />}
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-gray-800">Afternoon batch <span className="text-gray-400 font-normal">· 15:00 IST · optional 2nd pass</span></div>
              <div className={`text-[11px] ${!pmStale ? 'text-gray-500' : 'text-gray-400'}`}>Last ran: {fmtIST(pmAt)}{agoText(pmH)}</div>
            </div>
          </div>
        </div>
        {critical ? (
          <p className="mt-2.5 text-[12px] text-rose-700 leading-relaxed">
            The morning batch hasn&rsquo;t run in over a day. Confirm <b>CRON_SECRET</b> is set on Vercel (Production) and the Vercel <b>Crons</b> tab shows recent runs.
          </p>
        ) : pmStale ? (
          <p className="mt-2.5 text-[12px] text-gray-500 leading-relaxed">
            All good — the morning batch runs every job. The afternoon run is just an optional 2nd pass (extra retries); Vercel&rsquo;s free plan often skips it, which is fine.
          </p>
        ) : (
          <p className="mt-2.5 text-[12px] text-gray-500 leading-relaxed">
            Both batches ran. Every daily job is attempted morning and afternoon but runs once a day, so a skipped slot self-heals automatically.
          </p>
        )}
        <CronRunNowButton />
      </div>
    </div>
  )
}
