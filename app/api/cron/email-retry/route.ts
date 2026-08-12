// Email retry sweep. Re-dispatches email deliveries the route never confirmed
// (stuck 'pending') or that failed, under a 5-attempt cap; dead-letters the
// rest and bell-alerts admins. Called by the cron dispatcher (am + pm slots).
// POST lets a cost-control admin run it on demand.
import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json({ ok: false, reason: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  }
  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  })
  const { data, error } = await supabase.rpc('email_retry_sweep')
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  // Telegram uses the same stuck/failed retry model — sweep it in the same pass.
  const { data: tg } = await supabase.rpc('telegram_retry_sweep')
  return NextResponse.json({ ok: true, ...(data ?? {}), telegram: tg ?? null })
}

// Manual trigger for a cost-control admin.
export async function POST() {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('email_retry_sweep')
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  const { data: tg } = await supabase.rpc('telegram_retry_sweep')
  return NextResponse.json({ ok: true, ...(data ?? {}), telegram: tg ?? null })
}
