// IN4 budget sync.
//
//   GET  ?cron=1  — the cron dispatcher, twice a day (Bearer CRON_SECRET).
//   POST          — "Run now" from /budget/in4 (budget-vs-actual admin), with an
//                   optional { mode: 'shadow' | 'live' } to force one run.
//
// The route only reaches IN4 when the five IN4_DB_* variables are set; without
// them it answers 503 with the reason instead of failing quietly.

import { NextRequest, NextResponse } from 'next/server'
import { getMyPermissions, can, getMyUser } from '@/lib/auth'
import { in4Config } from '@/lib/in4/db'
import { runIn4Sync } from '@/lib/in4/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Ten SELECTs to Virginia plus a few thousand upserts — comfortably under a
// minute, but not the default 10 s.
export const maxDuration = 120

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('cron') !== '1') {
    return NextResponse.json({ ok: false, reason: 'Cron only' }, { status: 405 })
  }
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  if (!in4Config()) {
    return NextResponse.json({ ok: false, reason: 'IN4 is not configured on this deployment (IN4_DB_* env vars missing)' }, { status: 503 })
  }
  const result = await runIn4Sync({ trigger: 'cron', actorId: null })
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

export async function POST(req: NextRequest) {
  const perms = await getMyPermissions()
  if (!can(perms, 'budget-vs-actual', 'admin') && !can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden' }, { status: 403 })
  }
  if (!in4Config()) {
    return NextResponse.json({ ok: false, reason: 'IN4 is not configured on this deployment (IN4_DB_* env vars missing)' }, { status: 503 })
  }
  let body: { mode?: 'shadow' | 'live' } = {}
  try { body = await req.json() } catch { /* no body is fine */ }
  const user = await getMyUser()
  const result = await runIn4Sync({ trigger: 'manual', actorId: user?.id ?? null, forceMode: body.mode })
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
