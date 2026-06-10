// Cost Control data backup endpoint. Two modes:
//
//   1. Cron (?cron=1 + Bearer CRON_SECRET): build the .xlsx and upload it
//      to the private cc-backups storage bucket, then prune to the last
//      ~30 files. Wired to a daily Vercel cron in vercel.json.
//
//   2. User (GET, cost-control admin): build + stream the .xlsx straight
//      back as a download — the "Download full backup" button.
//
// The backup is a faithful multi-sheet snapshot of every Cost Control
// table (see lib/cost-control/backup.ts).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'
import { buildCostControlBackup } from '@/lib/cost-control/backup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_SECRET = process.env.CRON_SECRET
const BUCKET = 'cc-backups'
const KEEP = 30 // retain the most recent N daily backups

export async function GET(req: NextRequest) {
  const isCron = req.nextUrl.searchParams.get('cron') === '1'

  if (isCron) {
    const auth = req.headers.get('authorization') || ''
    if (CRON_SECRET && auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    const perms = await getMyPermissions()
    if (!can(perms, 'cost-control', 'admin')) {
      return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 })
    }
  }

  const supabase = await createClient()
  // Build with a fixed stamp (Date is allowed in a route handler).
  const stamp = new Date().toISOString()
  const { buffer, filename, sheetCounts } = await buildCostControlBackup(supabase, stamp)

  // ── User download ───────────────────────────────────────────────────
  if (!isCron) {
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  // ── Cron: upload to storage + prune ─────────────────────────────────
  const path = filename // flat — one file per day
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    upsert: true, // a same-day re-run overwrites rather than duplicating
  })
  if (upErr) {
    return NextResponse.json({ ok: false, error: `Upload failed: ${upErr.message}` }, { status: 500 })
  }

  // Prune: keep the newest KEEP files, delete the rest.
  const { data: listed } = await supabase.storage.from(BUCKET).list('', { limit: 1000, sortBy: { column: 'name', order: 'desc' } })
  const stale = (listed ?? []).map(f => f.name).filter(n => n.endsWith('.xlsx')).slice(KEEP)
  if (stale.length > 0) {
    await supabase.storage.from(BUCKET).remove(stale)
  }

  // Record a marker in app_settings so the dashboard can show "last backup".
  await supabase.from('app_settings').upsert(
    { key: 'cc_last_backup', value: JSON.stringify({ at: stamp, file: filename, sheets: sheetCounts }) },
    { onConflict: 'key' },
  )

  return NextResponse.json({ ok: true, file: filename, sheets: sheetCounts, pruned: stale.length })
}
