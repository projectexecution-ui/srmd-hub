// Bills Approval — the reconciliation sweep.
//
//   GET  ?cron=1  — the cron dispatcher, both passes. Bearer CRON_SECRET.
//   POST          — "Check now" from /bills-booking/sanctions (admin only).
//
// Compares every live sanction against IN4 as it stands, writes the verdict,
// and sends a notice for anything that changed. Idempotent: running it twice
// sends nothing the second time.

import { NextRequest, NextResponse } from 'next/server'
import { getMyPermissions, can } from '@/lib/auth'
import { runReconcileSweep } from '@/lib/bills-booking/sweep'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_SECRET = process.env.CRON_SECRET

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('cron') !== '1') {
    return NextResponse.json({ ok: false, reason: 'Use POST to run this by hand.' }, { status: 405 })
  }
  // Fail closed: with no secret configured, nobody gets in.
  if (!CRON_SECRET || req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const result = await runReconcileSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST() {
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-booking', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Admin only.' }, { status: 403 })
  }
  try {
    const result = await runReconcileSweep()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
