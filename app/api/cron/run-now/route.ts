// Manual "run the daily jobs now" — for the mornings Vercel's free-plan cron is
// late or skipped. Admin/Portal-Owner only (their session is the gate); the
// server then triggers the normal dispatcher with its own CRON_SECRET, so the
// same ledger applies (jobs already done today are skipped — no double-send).

import { NextResponse } from 'next/server'
import { getMyProfile, isPortalOwner } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function baseUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return `https://${prod || 'ct-hub.vercel.app'}`
}

export async function POST() {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!(owner || profile?.role === 'admin')) {
    return NextResponse.json({ ok: false, error: 'Admins only' }, { status: 403 })
  }
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET is not set on the server — the daily jobs can’t run until it is.' }, { status: 503 })
  }

  try {
    const res = await fetch(baseUrl() + '/api/cron/dispatch?cron=1&slot=am', {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
    })
    const body = await res.json().catch(() => ({} as { ran?: number; ok_count?: number }))
    if (!res.ok) return NextResponse.json({ ok: false, error: `Dispatcher returned ${res.status}` }, { status: 502 })
    return NextResponse.json({ ok: true, ran: body.ran ?? 0, ok_count: body.ok_count ?? 0 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Run failed' }, { status: 500 })
  }
}
