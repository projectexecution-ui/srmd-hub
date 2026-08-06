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
// IMPORTANT (until Vercel Pro): do NOT add new entries to vercel.json "crons".
// Add the job to the CRON_JOBS registry in lib/cron/schedule.ts instead.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { plannedJobs, stampLedger, legacyJobs, istDateOf, isEveryThirdDay, type Slot } from '@/lib/cron/schedule'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LEDGER_KEY = 'cron_ledger'

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

async function runJob(base: string, path: string, secret: string) {
  try {
    const res = await fetch(base + path, {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
    })
    let body: unknown = null
    try { body = await res.json() } catch { /* non-JSON is fine */ }
    return { path, status: res.status, ok: res.ok, body }
  } catch (e) {
    return { path, status: 0, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
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
  const istDate = istDateOf(nowMs)
  const every3 = isEveryThirdDay(nowMs)
  const supa = serviceClient()

  // Read today's ledger. If we can't (no service key / read error), FALL OPEN to
  // the legacy per-slot lists so behaviour equals the old am=full / pm=subset
  // split — never "run every daily job in both slots" (which would double-send).
  // app_settings.value is TEXT, so the ledger is a JSON string.
  let ledger: Record<string, string> | null = null
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
    }
  }

  let results: Array<{ path: string; status: number; ok: boolean; key?: string; policy?: 'daily' | 'each'; body?: unknown; error?: string }>
  let mode: 'ledger' | 'legacy'

  if (ledger) {
    mode = 'ledger'
    const planned = plannedJobs(slot, ledger, istDate, every3)
    results = await Promise.all(planned.map(async j => ({ ...(await runJob(base, j.path, CRON_SECRET)), key: j.key, policy: j.policy })))
    // Persist: stamp daily successes + the heartbeat. Fail-open (best effort).
    const nextLedger = stampLedger(ledger, results.map(r => ({ key: r.key!, policy: r.policy!, ok: r.ok })), istDate)
    try {
      await supa!.from('app_settings').upsert([
        { key: LEDGER_KEY, value: JSON.stringify(nextLedger) },
        { key: `cron_heartbeat_${slot}`, value: new Date(nowMs).toISOString() },
      ], { onConflict: 'key' })
    } catch { /* ledger/heartbeat persistence is best-effort — never fail the run over it */ }
  } else {
    mode = 'legacy'
    const jobs = legacyJobs(slot, every3)
    results = await Promise.all(jobs.map(p => runJob(base, p, CRON_SECRET)))
  }

  const okCount = results.filter(r => r.ok).length
  return NextResponse.json({ ok: true, slot, mode, ran: results.length, ok_count: okCount, results })
}
