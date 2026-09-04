// Google Drive archive of everything uploaded to CT Hub.
//
//   GET ?cron=1 — the cron dispatcher (both slots). Copies stored files not yet
//                 in Drive (bounded per run) and moves deleted ones under Archive/.
//   POST        — admin "run now".
//
// Answers 503 with the reason until GOOGLE_SERVICE_ACCOUNT_JSON and
// GDRIVE_ROOT_FOLDER_ID are set — nothing silent.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyProfile } from '@/lib/auth'
import { driveConfig } from '@/lib/drive'
import { runDriveArchive } from '@/lib/drive-archive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const CRON_SECRET = process.env.CRON_SECRET

function svc() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
}

async function run() {
  if (!driveConfig()) return NextResponse.json({ ok: false, reason: 'Google Drive is not configured (GOOGLE_SERVICE_ACCOUNT_JSON / GDRIVE_ROOT_FOLDER_ID missing)' }, { status: 503 })
  const sb = svc()
  const result = await runDriveArchive(sb)
  await sb.from('app_settings').upsert({ key: 'drive_last_archive', value: JSON.stringify({ at: new Date().toISOString(), ...result, errors: result.errors.slice(0, 20) }) }, { onConflict: 'key' })
  return NextResponse.json({ ok: result.failed === 0, ...result }, { status: 200 })
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('cron') !== '1') return NextResponse.json({ ok: false, reason: 'Cron only' }, { status: 405 })
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  return run()
}

export async function POST() {
  const profile = await getMyProfile()
  if (!profile || (profile.role !== 'admin' && !profile.is_portal_owner)) return NextResponse.json({ ok: false, reason: 'Forbidden' }, { status: 403 })
  return run()
}
