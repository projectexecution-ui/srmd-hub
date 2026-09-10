// Cron: cumulative "still not in IN4" follow-up digests.
// Calls the cc_in4_followup_digests DB function, which emails each Project Head
// / Atm Head ONE summary of every released sheet still not entered in IN4 after
// 3+ days (Work Orders blocked until entry). Delivery rides the native Gmail
// notification queue. Runs from a Vercel cron; authed by CRON_SECRET.
import { NextResponse } from 'next/server'
import { IS_DEMO, DEMO_BLOCKED_MESSAGE } from '@/lib/demo-mode'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  // Service-role GET outside /api/cron/, so proxy.ts does not stop it; the
  // trial site refuses it here (F-005). It sends digests and writes deliveries.
  if (IS_DEMO) return NextResponse.json({ ok: false, error: DEMO_BLOCKED_MESSAGE, demo: true }, { status: 403 })
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })

  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc('cc_in4_followup_digests')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, digests: data })
}
