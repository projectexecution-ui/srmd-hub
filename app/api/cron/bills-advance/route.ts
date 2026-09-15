import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/** Move every bill whose measurement IN4 has approved since CT Hub last looked.
 *
 *  Aksha, 15 Sep 2026: "he has to make Abstract and GRN in IN4 after it
 *  approves it should go to CT DISC HEAD AUTO." The Site Head does not click
 *  Forward — he measures once, in IN4, and IN4's approval is what moves the
 *  bill. The same rule closes the review loop: the Disc Head sends back with a
 *  reason, the Site Head revises in IN4, and the next approval brings it back.
 *
 *  All the work is in `bb_rpc_advance_measured()`, because the decision is a
 *  comparison between two things that both live in Postgres — the bill and the
 *  mirrored measurement — and doing it in SQL keeps it atomic. This route only
 *  calls it on the dispatcher's schedule.
 *
 *  Service role: nobody is acting, IN4 is. There is no desk membership to check
 *  and no `auth.uid()` to attribute it to, which is why the event it writes
 *  carries a null actor and says so in words. */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not set' }, { status: 500 })
  }
  // The dispatcher calls this with ?cron=1; a bare hit from a browser should
  // not silently move money-flow state.
  if (new URL(req.url).searchParams.get('cron') !== '1') {
    return NextResponse.json({ ok: false, error: 'This job runs from the cron dispatcher' }, { status: 403 })
  }

  const sb = createServiceClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await sb.rpc('bb_rpc_advance_measured')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const r = (data ?? {}) as { checked?: number; moved?: number }
  return NextResponse.json({
    ok: true,
    checked: r.checked ?? 0,
    moved: r.moved ?? 0,
    summary: `${r.moved ?? 0} of ${r.checked ?? 0} bills at the Site Head moved on — IN4 approved the measurement`,
  })
}
