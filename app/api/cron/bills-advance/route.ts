import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/** Two sweeps over the IN4 mirror, in order, twice a day.
 *
 *  1. RAISE. Aksha, 16 Sep 2026 — screen A of the look-and-feel preview, "Build
 *     it": bills raise themselves. IN4 raised 597 bills in 90 days and nobody
 *     is going to type them twice; the module stayed empty for exactly that
 *     reason. When an approved abstract appears in the mirror for a bill CT Hub
 *     does not have, `bb_rpc_raise_from_in4()` creates it at the Disc Head desk
 *     with the measurement already stamped. Only abstracts dated on or after
 *     the go-live watermark (app_settings 'bb_autoraise_since'), never one IN4
 *     has already paid.
 *
 *  2. ADVANCE. Aksha, 15 Sep 2026: "he has to make Abstract and GRN in IN4
 *     after it approves it should go to CT DISC HEAD AUTO." Bills already
 *     sitting at the Site Head move on when IN4 approves — and come back after
 *     a send-back only once IN4 approves a DIFFERENT measurement.
 *
 *  Both decisions are comparisons between two things that live in Postgres —
 *  the bill and the mirrored measurement — so both live in SQL and this route
 *  only calls them on the dispatcher's schedule. Service role: nobody is
 *  acting, IN4 is, and the events carry a null actor and say so in words. */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not set' }, { status: 500 })
  }
  // The dispatcher calls this with ?cron=1; a bare hit from a browser should
  // not silently create or move money-flow state.
  if (new URL(req.url).searchParams.get('cron') !== '1') {
    return NextResponse.json({ ok: false, error: 'This job runs from the cron dispatcher' }, { status: 403 })
  }

  const sb = createServiceClient(url, key, { auth: { persistSession: false } })

  const raised = await sb.rpc('bb_rpc_raise_from_in4')
  if (raised.error) return NextResponse.json({ ok: false, error: `raise: ${raised.error.message}` }, { status: 500 })
  const advanced = await sb.rpc('bb_rpc_advance_measured')
  if (advanced.error) return NextResponse.json({ ok: false, error: `advance: ${advanced.error.message}` }, { status: 500 })

  const r = (raised.data ?? {}) as { checked?: number; raised?: number; note?: string }
  const a = (advanced.data ?? {}) as { checked?: number; moved?: number }
  return NextResponse.json({
    ok: true,
    raised: r.raised ?? 0,
    moved: a.moved ?? 0,
    checked: a.checked ?? 0,
    summary: `${r.raised ?? 0} raised from IN4${r.note ? ` (${r.note})` : ''} · ${a.moved ?? 0} of ${a.checked ?? 0} at the Site Head moved on`,
  })
}
