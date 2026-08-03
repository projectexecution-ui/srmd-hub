// Daily notification digest. Sweeps every user's "deferred" email/phone items
// (notifications whose type an admin set to Daily) into ONE digest per user and
// sends it. Called once a day by the cron dispatcher (morning slot). POST lets
// an admin trigger it manually.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
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
  const { data, error } = await supabase.rpc('notification_send_daily_digests')
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, digests_sent: data ?? 0 })
}

// Manual trigger for a cost-control admin (e.g. "send the digest now" while testing).
export async function POST() {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('notification_send_daily_digests')
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, digests_sent: data ?? 0 })
}
