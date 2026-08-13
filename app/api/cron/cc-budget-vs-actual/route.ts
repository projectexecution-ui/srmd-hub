// Weekly "Budget vs Actual — portfolio" report to management. Fired by the cron
// dispatcher; self-gates to Monday IST (BPH refreshes weekly, so a daily send
// would repeat the same numbers). Calls cc_budget_vs_actual_report(), which
// builds one rich card (per-project ERP budget vs actual + % used) and sends it
// to every CC-management/reviewer. POST lets a cost-control admin preview it to
// their own Telegram on demand (onlyMe).

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function serviceClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  if (!CRON_SECRET || (req.headers.get('authorization') || '') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  }
  // Weekly — Monday only (IST). 1 = Monday.
  const istDow = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCDay()
  if (istDow !== 1) return NextResponse.json({ ok: true, skipped: 'not-monday' })

  const { data, error } = await serviceClient().rpc('cc_budget_vs_actual_report')
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sent: data ?? 0 })
}

// Admin on-demand preview. `onlyMe: true` sends only to the calling admin.
export async function POST(req: Request) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  }
  const body = await req.json().catch(() => ({} as { onlyMe?: boolean }))
  let onlyUser: string | null = null
  if (body?.onlyMe) {
    const me = await getMyUser()
    onlyUser = me?.id ?? null
  }
  const { data, error } = await serviceClient().rpc('cc_budget_vs_actual_report', { p_only_user: onlyUser })
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sent: data ?? 0 })
}
