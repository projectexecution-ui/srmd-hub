// Daily low-stock nudge — called by the cron dispatcher (morning slot).
// Notifies each store's keeper (fallback admins) of what's running low, via the
// shared notify_user pipeline. Authenticates with Bearer CRON_SECRET like the
// other cron routes.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ ok: false, reason: 'Missing Supabase service config' }, { status: 500 })
  }

  const supabase = createServiceClient(url, key, { auth: { persistSession: false } })

  // Respect the Inventory setting (default on).
  const { data: setting } = await supabase.from('app_settings').select('value').eq('key', 'inv_low_stock_alerts').maybeSingle()
  const on = ['true', '1', 'on', null, undefined].includes((setting?.value as string) ?? null)
  if (!on) return NextResponse.json({ ok: true, skipped: 'low_stock_alerts off' })

  const { data, error } = await supabase.rpc('inv_low_stock_digest')
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, ...(data as object) })
}
