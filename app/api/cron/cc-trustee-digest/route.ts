// Trustee release digest — one grouped "budgets to release" summary per founder
// instead of a card per budget. Fired by the cron dispatcher (am + pm; the
// ledger runs it at most once per IST day). POST lets a cost-control admin
// preview the digest to their own Telegram.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import { sendTrusteeDigests } from '@/lib/telegram/cc-trustee-digest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function svc() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}
function configured() {
  return !!(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.TELEGRAM_BOT_TOKEN)
}

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  if (!CRON_SECRET || (req.headers.get('authorization') || '') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  if (!configured()) return NextResponse.json({ ok: false, reason: 'Telegram not configured' }, { status: 503 })
  const res = await sendTrusteeDigests(svc(), process.env.TELEGRAM_BOT_TOKEN!)
  return NextResponse.json({ ok: true, ...res })
}

// Admin preview — sends only to the calling admin's own Telegram.
export async function POST() {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  if (!configured()) return NextResponse.json({ ok: false, reason: 'Telegram not configured' }, { status: 503 })
  const me = await getMyUser()
  const res = await sendTrusteeDigests(svc(), process.env.TELEGRAM_BOT_TOKEN!, me?.id ?? null)
  return NextResponse.json({ ok: true, ...res })
}
