// Daily digest for engineers on Internal Estimate.
//
//   GET  (Vercel cron, Bearer CRON_SECRET) → send each engineer who has a
//        RETURNED sheet or an unsent DRAFT their personal summary (awaiting
//        approval is shown as context). Smart: nothing to act on → no mail.
//   POST (cost-control edit) → run it now; optional { userId } sends just that
//        one engineer their digest (for a "send me a test").
//
// Delivery rides the native Gmail queue via notify_user() → respects each
// engineer's own notification preferences + the /admin/notifications policy.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function serviceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } })
}

// ── GET: the daily cron ─────────────────────────────────────────────────────
export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })

  const { data, error } = await supabase.rpc('cc_engineer_digests')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sent: data ?? 0 })
}

// ── POST: run now / send a test to one engineer ─────────────────────────────
export async function POST(req: Request) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'edit')) {
    return NextResponse.json({ ok: false, reason: 'Not allowed' }, { status: 403 })
  }
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })

  const body = await req.json().catch(() => ({} as { userId?: string }))
  const { data, error } = await supabase.rpc('cc_engineer_digests', { p_only_user: body.userId ?? null })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sent: data ?? 0 })
}
