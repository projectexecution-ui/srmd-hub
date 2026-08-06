// Once-a-day digest of budgets the Trustee approved → the Project Head and the
// engineer who raised each. The Atm Head is told instantly (DB trigger); this
// covers the two who prefer a batched summary on the free plan's fixed cron.
//
//   GET  (Vercel cron, Bearer CRON_SECRET) → send everyone their pending list.
//        Exactly-once: cc_budget_approved_digest() stamps each event so nothing
//        is double-sent or missed, whatever time the cron fires.
//   POST (cost-control edit) → run it now; { userId } sends just that person a
//        preview without consuming the pending events (a "send me a test").
//
// Delivery rides notify_user() → each recipient's notification preferences + the
// /admin/notifications policy apply.

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

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })

  const { data, error } = await supabase.rpc('cc_budget_approved_digest')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sent: data ?? 0 })
}

export async function POST(req: Request) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'edit')) {
    return NextResponse.json({ ok: false, reason: 'Not allowed' }, { status: 403 })
  }
  const supabase = serviceClient()
  if (!supabase) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })

  const body = await req.json().catch(() => ({} as { userId?: string }))
  const { data, error } = await supabase.rpc('cc_budget_approved_digest', { p_only_user: body.userId ?? null })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sent: data ?? 0 })
}
