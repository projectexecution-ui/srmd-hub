// Cost Control data backup endpoint. Three modes:
//
//   1. Cron (GET ?cron=1 + Bearer CRON_SECRET): build the .xlsx with a
//      service-role client (the cron has no user cookie, so RLS would
//      return zero rows otherwise), upload it to the private cc-backups
//      storage bucket, then prune to the last ~30 files. Wired to a daily
//      Vercel cron in vercel.json.
//
//   2. User download (GET, cost-control admin): build + stream the .xlsx
//      straight back as a download — the "Download full backup" button.
//
//   3. Auto-backup (POST, cost-control admin): build with the caller's
//      session client and store to cc-backups. Fired by <AutoBackup/> when
//      the last stored backup is missing or older than 24h.
//
// The backup is a faithful multi-sheet snapshot of every Cost Control
// table (see lib/cost-control/backup.ts).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { getMyPermissions, can } from '@/lib/auth'
import { buildCostControlBackup, type BackupResult } from '@/lib/cost-control/backup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_SECRET = process.env.CRON_SECRET
const BUCKET = 'cc-backups'
const KEEP = 30 // retain the most recent N daily backups
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function totalRows(sheetCounts: Record<string, number>): number {
  return Object.values(sheetCounts).reduce((sum, n) => sum + n, 0)
}

// Upload one workbook, then prune the bucket to the newest KEEP files.
// Prune problems are non-fatal — the backup itself already succeeded.
async function uploadAndPrune(
  supabase: SupabaseClient, path: string, buffer: Buffer,
): Promise<{ uploadError: string | null; pruned: number }> {
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: XLSX_MIME,
    upsert: true, // a same-day re-run overwrites rather than duplicating
  })
  if (upErr) return { uploadError: upErr.message, pruned: 0 }

  // Sort by created_at, not name — cron files (cost-control-backup-*) and
  // auto-backup files (cc-backup-*) don't interleave alphabetically by date.
  const { data: listed, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
  if (listErr) {
    console.warn('cc-backups prune skipped — list failed:', listErr.message)
    return { uploadError: null, pruned: 0 }
  }
  const stale = (listed ?? []).map(f => f.name).filter(n => n.endsWith('.xlsx')).slice(KEEP)
  if (stale.length > 0) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(stale)
    if (rmErr) console.warn('cc-backups prune failed:', rmErr.message)
  }
  return { uploadError: null, pruned: stale.length }
}

// Marker in app_settings so the dashboard (and <AutoBackup/>) can tell when
// the last backup happened. Plain ISO timestamp string.
async function recordLastBackup(supabase: SupabaseClient, stampISO: string): Promise<string | null> {
  const { error } = await supabase.from('app_settings').upsert(
    { key: 'cc_last_backup', value: stampISO },
    { onConflict: 'key' },
  )
  return error ? error.message : null
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('cron') === '1') return cronBackup(req)

  // ── User download ─────────────────────────────────────────────────────
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }

  const supabase = await createClient()
  const stamp = new Date().toISOString()
  let backup: BackupResult
  try {
    backup = await buildCostControlBackup(supabase, stamp)
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : 'Couldn’t build the backup — please try again.' },
      { status: 500 },
    )
  }

  return new NextResponse(new Uint8Array(backup.buffer), {
    status: 200,
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${backup.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

// ── Cron: build with service role, upload to storage + prune ────────────
async function cronBackup(req: NextRequest) {
  // Fail CLOSED: a missing CRON_SECRET must reject, not wave everyone in.
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }

  // The cron request carries no user cookie, so an anon client reads zero
  // rows under RLS. The service-role key is the only working path here.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    return NextResponse.json(
      { ok: false, reason: 'Cron backup needs SUPABASE_SERVICE_ROLE_KEY on Vercel; daily auto-backup currently runs when an admin opens Cost Control.' },
      { status: 503 },
    )
  }
  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  })

  const stamp = new Date().toISOString()
  let backup: BackupResult
  try {
    backup = await buildCostControlBackup(supabase, stamp)
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : 'Backup build failed' },
      { status: 500 },
    )
  }
  if (totalRows(backup.sheetCounts) === 0) {
    // Zero rows on every table means the reads were blocked (or the DB is
    // empty) — storing an empty workbook and reporting success hides a failure.
    return NextResponse.json(
      { ok: false, reason: 'Backup read zero rows across all tables — nothing was stored.' },
      { status: 500 },
    )
  }

  const { uploadError, pruned } = await uploadAndPrune(supabase, backup.filename, backup.buffer)
  if (uploadError) {
    return NextResponse.json({ ok: false, reason: `Upload failed: ${uploadError}` }, { status: 500 })
  }

  const markerError = await recordLastBackup(supabase, stamp)
  if (markerError) {
    return NextResponse.json(
      { ok: false, reason: `Backup stored but couldn’t record the backup time: ${markerError}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    ok: true,
    file: backup.filename,
    bytes: backup.buffer.byteLength,
    sheets: backup.sheetCounts,
    pruned,
  })
}

// ── Auto-backup: admin session builds + stores to the bucket ────────────
export async function POST() {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }

  // The caller's own session client — a cost-control admin sees every
  // table via RLS, so no service key is needed on this path.
  const supabase = await createClient()
  const stamp = new Date().toISOString()
  let backup: BackupResult
  try {
    backup = await buildCostControlBackup(supabase, stamp)
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : 'Backup build failed' },
      { status: 500 },
    )
  }
  if (totalRows(backup.sheetCounts) === 0) {
    return NextResponse.json(
      { ok: false, reason: 'Backup read zero rows across all tables — nothing was stored.' },
      { status: 500 },
    )
  }

  const file = `cc-backup-${stamp.slice(0, 10)}.xlsx`
  const { uploadError } = await uploadAndPrune(supabase, file, backup.buffer)
  if (uploadError) {
    return NextResponse.json({ ok: false, reason: `Upload failed: ${uploadError}` }, { status: 500 })
  }

  const markerError = await recordLastBackup(supabase, stamp)
  if (markerError) {
    // Failing loudly here keeps <AutoBackup/> from toasting success while
    // the 24h marker silently never updates (it would re-fire every visit).
    return NextResponse.json(
      { ok: false, reason: `Backup stored but couldn’t record the backup time: ${markerError}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, file, bytes: backup.buffer.byteLength })
}
