// ── Single cron dispatcher ─────────────────────────────────────────────────
// Vercel's Hobby (free) plan allows only 2 cron jobs, each once/day, and they
// are BEST-EFFORT — a slot can be delayed or skipped. So we register just TWO
// Vercel crons that both hit THIS endpoint, and this endpoint fans out.
//
//   ?slot=am  (09:00 IST)   ?slot=pm  (15:00 IST)
//
// Robustness (see lib/cron/schedule.ts): every "daily" job is ATTEMPTED in BOTH
// slots but a shared ledger (app_settings.cron_ledger, keyed by IST date) makes
// it RUN at most once/day — so a skipped 09:00 self-heals at 15:00, a failed
// job retries next slot, and nothing double-sends. Each run also stamps a
// heartbeat (cron_heartbeat_am/pm) so a miss is visible on Admin → Notifications.
//
// THE WAIT BUDGET (added 23 Sep 2026). This function may run for 60 s. The jobs
// it fans out to are separate invocations with their own limits — the IN4 feeds
// allow themselves 120 s — and the dispatcher used to await every one of them
// before writing the ledger. When the slowest feed took longer than the
// dispatcher's own limit, Vercel killed the dispatcher on the await: the jobs
// had already been launched and finished on their own (cc_last_backup and
// in4_sync_runs kept updating), but the line that stamps the ledger and the
// heartbeat was never reached. Nothing threw, so nothing was logged. It first
// happened the day in4-sync joined the registry (4 Sep 2026 — the duplicate
// approval reminders), and again from the 15 Sep afternoon slot once the trail
// and purchase feeds made the pass longer. So: every job gets the same wait
// budget, comfortably inside the 60 s, and a job that is still running when
// the budget ends is reported as such — it carries on by itself; this function
// simply stops waiting for it and goes on to persist.
//
// IMPORTANT (until Vercel Pro): do NOT add new entries to vercel.json "crons".
// Add the job to the CRON_JOBS registry in lib/cron/schedule.ts instead.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { plannedJobs, stampLedger, legacyJobs, istDateOf, isEveryThirdDay, type Slot } from '@/lib/cron/schedule'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LEDGER_KEY = 'cron_ledger'
// Admin → Notifications shows this when it is newer than the last heartbeat.
const LAST_ERROR_KEY = 'cron_last_error'
// How long to wait for the fan-out before persisting. 60 s is the hard limit
// for this function; the rest is headroom for the ledger write and the reply.
const WAIT_BUDGET_MS = 45_000

function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !url) return null
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

// Fan out over the PUBLIC production domain — never `req.url`'s origin. Vercel
// SSO Deployment Protection walls per-deploy *.vercel.app URLs behind auth, so a
// cron hitting `req.url` would 401 every internal fetch. The production alias is
// the exempt/public domain.
function baseUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return `https://${prod || 'ct-hub.vercel.app'}`
}

interface JobResult {
  path: string
  status: number
  ok: boolean
  key?: string
  policy?: 'daily' | 'each'
  body?: unknown
  error?: string
  /** The dispatcher stopped waiting; the job's own invocation carries on. */
  stillRunning?: boolean
}

async function runJob(base: string, path: string, secret: string, deadlineMs: number): Promise<JobResult> {
  const remaining = Math.max(1_000, deadlineMs - Date.now())
  try {
    const res = await fetch(base + path, {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(remaining),
    })
    let body: unknown = null
    try { body = await res.json() } catch { /* non-JSON is fine */ }
    return { path, status: res.status, ok: res.ok, body }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { path, status: 0, ok: false, stillRunning: true, error: `still running after the dispatcher's ${Math.round(WAIT_BUDGET_MS / 1000)}s wait — it finishes on its own` }
    }
    return { path, status: 0, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

/** Record a dispatcher error where Admin can see it. Best effort — if this
 *  write fails too, the console line is what is left, and it says so. */
async function recordError(supa: NonNullable<ReturnType<typeof serviceClient>>, slot: Slot, nowMs: number, message: string) {
  console.error(`[cron/dispatch] ${slot}: ${message}`)
  const { error } = await supa.from('app_settings').upsert(
    [{ key: LAST_ERROR_KEY, value: JSON.stringify({ at: new Date(nowMs).toISOString(), slot, message }) }],
    { onConflict: 'key' },
  )
  if (error) console.error(`[cron/dispatch] ${slot}: could not record that error either: ${errorText(error)}`)
}

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }

  const slot: Slot = new URL(req.url).searchParams.get('slot') === 'pm' ? 'pm' : 'am'
  const base = baseUrl()
  const nowMs = Date.now()
  const deadlineMs = nowMs + WAIT_BUDGET_MS
  const istDate = istDateOf(nowMs)
  const every3 = isEveryThirdDay(nowMs)
  const supa = serviceClient()

  // Read today's ledger. If we can't (no service key / read error), FALL OPEN to
  // the legacy per-slot lists so behaviour equals the old am=full / pm=subset
  // split — never "run every daily job in both slots" (which would double-send).
  // app_settings.value is TEXT, so the ledger is a JSON string.
  let ledger: Record<string, string> | null = null
  let ledgerReadError: string | null = null
  // Modules the Portal Owner has switched off. A switched-off module's job is
  // skipped here, so "off" means off for its digests and reminders too — not
  // just for its tile. Read failure → empty set → every job runs (fail open).
  const disabledModules = new Set<string>()
  if (supa) {
    const { data: vis } = await supa.from('module_visibility').select('slug, enabled')
    for (const r of (vis ?? []) as Array<{ slug: string; enabled: boolean }>) if (!r.enabled) disabledModules.add(r.slug)
  }
  if (supa) {
    const { data, error } = await supa.from('app_settings').select('value').eq('key', LEDGER_KEY).maybeSingle()
    if (!error) {
      ledger = {}
      const raw = data?.value
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const p = JSON.parse(raw)
          if (p && typeof p === 'object' && !Array.isArray(p)) ledger = p as Record<string, string>
        } catch { /* corrupt ledger → treat as empty (runs + re-stamps today) */ }
      }
    } else {
      ledgerReadError = errorText(error)
    }
  }

  let results: JobResult[]
  let mode: 'ledger' | 'legacy'
  // 'ok' = ledger + heartbeat written; 'failed' = the write was refused (see
  // persist_error and app_settings.cron_last_error); 'skipped' = legacy mode.
  let persist: 'ok' | 'failed' | 'skipped' = 'skipped'
  let persistError: string | null = null

  if (ledger && supa) {
    mode = 'ledger'
    const planned = plannedJobs(slot, ledger, istDate, every3, disabledModules)
    results = await Promise.all(planned.map(async j => ({ ...(await runJob(base, j.path, CRON_SECRET, deadlineMs)), key: j.key, policy: j.policy })))
    // Persist: stamp daily successes + the heartbeat. Must never fail the run,
    // but must never be silent either: supabase-js does not throw on a refused
    // write, it hands back `error` — so check it, log it, and record it.
    try {
      const nextLedger = stampLedger(ledger, results.map(r => ({ key: r.key!, policy: r.policy!, ok: r.ok, stillRunning: r.stillRunning })), istDate)
      const { error } = await supa.from('app_settings').upsert([
        { key: LEDGER_KEY, value: JSON.stringify(nextLedger) },
        { key: `cron_heartbeat_${slot}`, value: new Date(nowMs).toISOString() },
      ], { onConflict: 'key' })
      if (error) {
        persist = 'failed'
        persistError = `ledger/heartbeat write refused: ${errorText(error)}`
        await recordError(supa, slot, nowMs, persistError)
      } else {
        persist = 'ok'
      }
    } catch (e) {
      persist = 'failed'
      persistError = `ledger/heartbeat write threw: ${errorText(e)}`
      await recordError(supa, slot, nowMs, persistError)
    }
  } else {
    mode = 'legacy'
    const jobs = legacyJobs(slot, every3)
    results = await Promise.all(jobs.map(p => runJob(base, p, CRON_SECRET, deadlineMs)))
    if (supa && ledgerReadError) await recordError(supa, slot, nowMs, `ledger read failed, ran the legacy lists: ${ledgerReadError}`)
  }

  const okCount = results.filter(r => r.ok).length
  const stillRunning = results.filter(r => r.stillRunning).map(r => r.key ?? r.path)
  const failed = results.filter(r => !r.ok && !r.stillRunning).map(r => r.key ?? r.path)
  return NextResponse.json({
    ok: true, slot, mode, ran: results.length, ok_count: okCount,
    still_running: stillRunning, failed,
    persist, persist_error: persistError,
    waited_ms: Date.now() - nowMs,
    skipped_modules: [...disabledModules], results,
  })
}
