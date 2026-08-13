// Daily "budget waiting for your approval" reminder (Cost Control). Fired by the
// cron dispatcher (am + pm slots; the ledger runs it at most once per IST day).
// Calls cc_approval_reminders(), which notifies each current-stage approver of
// budgets still pending their sign-off since a previous day, and escalates
// items stuck 3+ days. POST lets a cost-control admin run it on demand (their
// own account for a safe test via p_only_user).

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
  const { data, error } = await serviceClient().rpc('cc_approval_reminders')
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sent: data ?? 0 })
}

// Admin on-demand run. Gated by the admin's session; the RPC itself is
// service-role only, so we run it through the service client after the check.
// `onlyMe: true` sends only to the calling admin — a safe way to preview.
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
  const { data, error } = await serviceClient().rpc('cc_approval_reminders', { p_only_user: onlyUser })
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, sent: data ?? 0 })
}
