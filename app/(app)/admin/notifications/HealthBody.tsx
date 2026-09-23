import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDateTime } from '@/lib/utils'
import { FEEDS, FEED_META } from '@/lib/in4/feeds'
import { CRON_JOBS } from '@/lib/cron/schedule'
import { EmailHealthStrip, type DeliveryHealth } from './EmailHealthStrip'
import { CronHealthStrip } from './CronHealthStrip'

type Run = { feed: string | null; started_at: string; finished_at: string | null; ok: boolean | null; error: string | null; rows_read: number | null; trigger: string }

/** Everything the Job health tab shows, fetched once. Kept out of the
 *  component so the render itself is pure (the clock is read here). */
async function loadHealthPanel() {
  const supabase = await createClient()
  const [{ data: healthData }, { data: settings }, { data: runs }] = await Promise.all([
    supabase.rpc('email_delivery_health'),
    supabase.from('app_settings').select('key, value').in('key', ['cron_heartbeat_am', 'cron_heartbeat_pm', 'cron_ledger']),
    supabase.from('in4_sync_runs').select('feed, started_at, finished_at, ok, error, rows_read, trigger').order('id', { ascending: false }).limit(80),
  ])
  const by = new Map(((settings ?? []) as Array<{ key: string; value: string }>).map(r => [r.key, r.value]))
  // Build defensively: tolerate the pre-migration flat shape (no email/push
  // keys) so the strip never crashes in the deploy→migration window.
  const emptyChannel = { counts: {}, stuck: 0, recent: [] }
  const raw = (healthData ?? null) as Partial<DeliveryHealth> | null
  const health: DeliveryHealth = { email: raw?.email ?? emptyChannel, push: raw?.push ?? emptyChannel }

  let ledger: Record<string, string> = {}
  try { const p = JSON.parse(by.get('cron_ledger') ?? '{}'); if (p && typeof p === 'object') ledger = p } catch { ledger = {} }

  const latest = new Map<string, Run>()
  for (const r of (runs ?? []) as Run[]) { const f = r.feed ?? 'budget'; if (!latest.has(f)) latest.set(f, r) }

  return {
    health,
    amAt: by.get('cron_heartbeat_am') ?? null,
    pmAt: by.get('cron_heartbeat_pm') ?? null,
    ledger,
    latest,
    nowMs: Date.now(),
  }
}

/**
 * Job health — the Messages door's last tab (H1). Three things, each from its
 * own record rather than a heartbeat: did the e-mails and pushes go
 * (email_delivery_health), did the two cron slots run (heartbeats, with Run
 * now), and — new — what each IN4 feed's last run actually returned, and when
 * each daily job last succeeded according to the ledger. The strip on the
 * Admin home reads the same rows; this is where you come to see all of them.
 */
export async function HealthBody() {
  const { health, amAt, pmAt, ledger, latest, nowMs } = await loadHealthPanel()
  const daily = CRON_JOBS.filter(j => j.policy === 'daily')

  return (
    <div className="space-y-4">
      <EmailHealthStrip health={health} />
      <CronHealthStrip amAt={amAt} pmAt={pmAt} nowMs={nowMs} />

      <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">IN4 feeds — last run of each</h2>
          <p className="text-[12px] text-gray-500">What the feed itself recorded. Switches, comparisons and Run now are on <Link href="/admin/data?tab=in4" className="text-indigo-700 hover:underline">Data › IN4 live sync</Link>.</p>
        </div>
        <ul className="divide-y divide-gray-100">
          {FEEDS.map(f => {
            const r = latest.get(f)
            const tone = !r ? 'text-gray-400' : r.ok === true ? 'text-emerald-700' : r.ok === false ? 'text-rose-700' : 'text-amber-700'
            const word = !r ? 'never run' : r.ok === true ? 'ok' : r.ok === false ? 'FAILED' : 'started, no result'
            return (
              <li key={f} className="px-4 py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-sm font-medium text-gray-900 min-w-[200px]">{FEED_META[f].label}</span>
                <span className={`text-[12.5px] font-semibold ${tone}`}>{word}</span>
                {r && <span className="text-[12px] text-gray-500 tabular-nums">{formatDateTime(r.started_at)}{r.rows_read != null ? ` · ${r.rows_read.toLocaleString('en-IN')} rows` : ''} · {r.trigger}</span>}
                {r?.error && <span className="basis-full text-[12px] text-rose-700">{r.error}</span>}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-bold text-gray-900">Daily jobs — last day each succeeded</h2>
          <p className="text-[12px] text-gray-500">From the scheduled-jobs record. A job stamped today has run; one stamped days ago has either failed or gone unrecorded.</p>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 divide-y divide-gray-100 sm:divide-y-0">
          {daily.map(j => {
            const d = ledger[j.key]
            return (
              <li key={j.key} className="px-4 py-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-mono text-[12px] text-gray-700">{j.key}</span>
                <span className={`tabular-nums text-[12.5px] ${d ? 'text-gray-700' : 'text-gray-400'}`}>{d ?? 'never'}</span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
