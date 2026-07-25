// BPH → Cost Control auto-sync cron.
//
//   GET ?cron=1  — Vercel Cron (twice a day). Fail-closed CRON_SECRET auth.
//
// Re-runs the mapped BPH pulls for every linked project so Cost Control's ERP
// budget/actuals stay fresh from the latest uploaded BPH report without anyone
// clicking "Sync from BPH". The pull is idempotent — unchanged figures are
// re-written as-is (no audit event), and code-only matching (no AI) means it
// never guesses a mapping unattended. Uses the service-role client so the
// writes aren't blocked by RLS (there is no user session in a cron).

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { runAllMappedPulls } from '@/app/(app)/cost-control/import/bph/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
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

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ ok: false, reason: 'SUPABASE_SERVICE_ROLE_KEY is not set' }, { status: 503 })
  }
  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  })

  try {
    const res = await runAllMappedPulls({ client: supabase, actorId: null })
    const synced = res.outcomes.filter(o => o.ok).length
    const errors = res.outcomes.length - synced
    return NextResponse.json({
      ok: true,
      ran_at: res.ran_at,
      mappings: res.outcomes.length,
      synced,
      errors,
      failures: res.outcomes.filter(o => !o.ok).map(o => ({ cc_project_id: o.cc_project_id, error: o.error })),
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : 'BPH sync failed' },
      { status: 500 },
    )
  }
}
