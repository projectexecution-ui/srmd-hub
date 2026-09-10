// Run ONE scheduled job now — the "Send now" button on Admin → Reports & digests.
// Admin / Portal Owner only. Calls the job's own route with the server's
// CRON_SECRET, the same way the dispatcher does, so nothing is special-cased.

import { NextResponse } from 'next/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { CRON_JOBS } from '@/lib/cron/schedule'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function baseUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return `https://${prod || 'ct-hub.vercel.app'}`
}

export async function POST(req: Request) {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!(owner || profile?.role === 'admin')) return NextResponse.json({ ok: false, error: 'Admins only' }, { status: 403 })
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ ok: false, error: 'CRON_SECRET is not set on the server.' }, { status: 503 })

  let key = ''
  try { key = String(((await req.json()) as { key?: string }).key ?? '') } catch { /* no body */ }
  const job = CRON_JOBS.find(j => j.key === key)
  if (!job) return NextResponse.json({ ok: false, error: `No scheduled job called "${key}".` }, { status: 400 })
  const path = job.am ?? job.pm
  if (!path) return NextResponse.json({ ok: false, error: 'That job has no route.' }, { status: 400 })

  try {
    const res = await fetch(baseUrl() + path, { headers: { authorization: `Bearer ${secret}` }, cache: 'no-store' })
    let body: unknown = null
    try { body = await res.json() } catch { /* non-JSON is fine */ }
    return NextResponse.json({ ok: res.ok, status: res.status, body }, { status: res.ok ? 200 : 502 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Run failed' }, { status: 500 })
  }
}
