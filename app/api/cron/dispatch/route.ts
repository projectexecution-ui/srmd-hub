// ── Single cron dispatcher ─────────────────────────────────────────────────
// Vercel's Hobby (free) plan allows only 2 cron jobs, each once/day. The app
// has many scheduled jobs, so instead of one Vercel cron per job (which
// silently drops everything past the 2nd), we register just TWO Vercel crons
// that both hit THIS endpoint, and this endpoint fans out to every job.
//
//   ?slot=am  (09:00 IST) → the full morning batch (digests, backups, reports)
//   ?slot=pm  (15:00 IST) → the afternoon refreshers (things that liked to run
//                            more than once a day; on the free plan they get 2×)
//
// IMPORTANT (until the account is on Vercel Pro): do NOT add new entries to
// vercel.json "crons". Add the new job's path to JOBS_AM (or JOBS_PM) below.
// Each target route already authenticates with Bearer CRON_SECRET, so we just
// call it with the same header. Frequencies finer than 2×/day can't be honored
// on the free plan — that's a plan limit, not a code one.

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Morning batch — everything runs once here.
// in4-followup wants an every-3-days cadence; it has no internal guard, so we
// gate it here by day-count so it doesn't turn into a daily email.
function morningJobs(): string[] {
  const every3rdDay = Math.floor(Date.now() / 86_400_000) % 3 === 0
  return [
    '/api/jmr/weekly-report?cron=1',      // self-decides the weekly day
    '/api/cost-control/backup?cron=1',
    ...(every3rdDay ? ['/api/cost-control/in4-followup?cron=1'] : []),
    '/api/cron/procurement-digest?cron=1', // self-gates weekday + once/day
    '/api/cron/engineer-digest?cron=1',
    '/api/cron/email-retry?cron=1',        // re-dispatch stuck/failed emails + dead-letter + alert
    '/api/cron/daily-site-report?cron=1',
    '/api/cron/bills-pipeline?cron=1',
    '/api/cron/bph-sync?cron=1',
  ]
}

// Afternoon refreshers — jobs that used to run several times a day. On the free
// plan they get a 2nd run here (2×/day total).
const JOBS_PM: string[] = [
  '/api/cron/bills-pipeline?cron=1&slot=pm',
  '/api/cron/bph-sync?cron=1',
  '/api/cron/email-retry?cron=1',          // 2nd retry pass so stuck emails don't wait a full day
]

// Fan out over the PUBLIC production domain — never `req.url`'s origin.
// Vercel SSO Deployment Protection is ON (Standard: all_except_custom_domains),
// so every per-deploy *.vercel.app URL is walled behind Vercel's auth. Under a
// cron, `req.url` resolves to that protected deploy URL, so internal fetches to
// it were 401'd BEFORE reaching the handler — the entry dispatch returned 200
// but every fanned-out job silently no-op'd (no digests, no cron backups ever).
// The production alias (VERCEL_PROJECT_PRODUCTION_URL, e.g. ct-hub.vercel.app)
// is the exempt/public domain, so target it.
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

  const slot = new URL(req.url).searchParams.get('slot') === 'pm' ? 'pm' : 'am'
  const jobs = slot === 'pm' ? JOBS_PM : morningJobs()
  const base = baseUrl()

  // Fire them all in parallel; one failing job never blocks the others.
  const results = await Promise.all(jobs.map(p => runJob(base, p, CRON_SECRET)))
  const okCount = results.filter(r => r.ok).length

  return NextResponse.json({ ok: true, slot, ran: results.length, ok_count: okCount, results })
}
