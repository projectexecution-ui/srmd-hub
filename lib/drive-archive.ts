// The Google Drive archive of everything uploaded to CT Hub.
//
// Supabase Storage stays the system of record — the app never reads from
// Drive, so Drive being slow or full cannot break a page. This module copies
// each stored file to the Shared drive, once, into a folder tree a person can
// browse, with the upload date in every file name; and when a file is deleted
// in the hub it MOVES the Drive copy under Archive/ (same tree, "__deleted-
// <date>" suffix). Nothing is ever purged.
//
//   <root>/
//     02 Internal Estimate/<project code>/<sheet code>/2026-08-27_1030_v3_Estimate.xlsx
//     03 Bills/…            04 JMR photos/<project>/<YYYY-MM>/…
//     05 Daily site reports/…   06 Backups/Cost Control/<YYYY>/…
//     07 Warehouse/…        Archive/<same tree>/…__deleted-2026-09-04.xlsx
//
// (01 IN4 reports arrives with the IN4 sync's own archive step — the report
// Excel files are no longer uploaded once the sync is live.)
//
// Runs from the cron dispatcher (drive-archive) and is safe to re-run: the
// drive_files table remembers what has been copied.

import type { SupabaseClient } from '@supabase/supabase-js'
import { driveConfig, ensureFolderPath, uploadFile, moveFile, istStamp, istYearMonth, safeName, type DriveConfig } from './drive'

/** Storage bucket → top-level Drive folder. Buckets not listed are not archived. */
export const BUCKET_FOLDERS: Record<string, string> = {
  'cc-sheets':            '02 Internal Estimate',
  'approval-attachments': '02 Internal Estimate',
  'bills-booking':        '03 Bills',
  'bills-pipeline':       '03 Bills',
  'jmr-photos':           '04 JMR photos',
  'site-reports':         '05 Daily site reports',
  'cc-backups':           '06 Backups',
  'wh-bills':             '07 Warehouse',
  'wh-gate-passes':       '07 Warehouse',
  'inv-gate-passes':      '07 Warehouse',
  'item-images':          '07 Warehouse',
}
export const ARCHIVE_ROOT = 'Archive'

export interface DriveFileRow {
  id: number; bucket: string; object_path: string; drive_id: string | null; drive_folder_id: string | null
  drive_path: string | null; file_name: string | null; uploaded_at: string | null; archived_at: string | null; error: string | null
}

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', csv: 'text/csv',
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  json: 'application/json', txt: 'text/plain',
}
const mimeFor = (name: string) => MIME[(name.split('.').pop() ?? '').toLowerCase()] ?? 'application/octet-stream'

/* eslint-disable @typescript-eslint/no-explicit-any */
type SB = SupabaseClient<any, any, any>

/** Where a stored object goes in Drive and what it is called there. Uses what
 *  the hub knows about the object (project code, sheet code) when it can. */
async function placeFor(sb: SB, bucket: string, objectPath: string, createdAt: Date): Promise<{ segments: string[]; name: string }> {
  const top = BUCKET_FOLDERS[bucket]
  const base = objectPath.split('/').pop() ?? objectPath
  const { year, month } = istYearMonth(createdAt)
  const stamped = `${istStamp(createdAt)}_${safeName(base)}`

  if (bucket === 'cc-sheets' || bucket === 'approval-attachments') {
    // cc-sheets objects are stored under the working sheet's id; look the sheet
    // up for its project code and sheet code so the folder reads like the hub.
    const wsId = objectPath.split('/').find(seg => /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg))
    if (wsId) {
      const { data } = await sb.from('cc_working_sheets').select('ws_code, projects(code)').eq('id', wsId).maybeSingle()
      const proj = (data?.projects as { code?: string } | { code?: string }[] | null)
      const code = Array.isArray(proj) ? proj[0]?.code : proj?.code
      if (data?.ws_code) return { segments: [top, safeName(code ?? 'Unassigned'), safeName(String(data.ws_code))], name: stamped }
    }
    return { segments: [top, 'Unassigned', year], name: stamped }
  }
  if (bucket === 'cc-backups') return { segments: [top, 'Cost Control', year], name: stamped }
  if (bucket === 'jmr-photos' || bucket === 'site-reports') {
    // First path segment is usually the project code / id.
    const first = objectPath.split('/')[0]
    return { segments: [top, safeName(first || 'Unassigned'), month], name: stamped }
  }
  return { segments: [top, year, month], name: stamped }
}

export interface ArchiveRunResult { configured: boolean; copied: number; moved: number; failed: number; errors: string[] }

/** Copy every stored object not yet in Drive; move the copies of deleted
 *  objects under Archive/. Bounded per run so a cron slot never overruns. */
export async function runDriveArchive(sb: SB, opts: { maxUploads?: number } = {}): Promise<ArchiveRunResult> {
  const cfg = driveConfig()
  if (!cfg) return { configured: false, copied: 0, moved: 0, failed: 0, errors: ['GOOGLE_SERVICE_ACCOUNT_JSON / GDRIVE_ROOT_FOLDER_ID not set'] }
  const res: ArchiveRunResult = { configured: true, copied: 0, moved: 0, failed: 0, errors: [] }
  const max = opts.maxUploads ?? 40

  // 1. What is stored, per archived bucket.
  const stored: Array<{ bucket: string; object_path: string; created_at: string; size: number }> = []
  // storage.objects is not on the REST API; list_storage_objects() (service
  // role only) reads it for us, one bucket at a time.
  for (const bucket of Object.keys(BUCKET_FOLDERS)) {
    const { data: objs, error } = await sb.rpc('list_storage_objects', { p_bucket: bucket })
    if (error) { res.errors.push(`${bucket}: ${error.message}`); continue }
    for (const o of (objs ?? []) as Array<{ name: string; created_at: string; size: number | null }>) {
      if (!o.name || o.name.endsWith('/') || o.name.endsWith('.emptyFolderPlaceholder')) continue
      stored.push({ bucket, object_path: o.name, created_at: o.created_at, size: Number(o.size ?? 0) })
    }
  }

  // 2. What we already copied.
  const { data: known, error: kErr } = await sb.from('drive_files').select('id, bucket, object_path, drive_id, drive_folder_id, drive_path, archived_at')
  if (kErr) { res.errors.push(`drive_files: ${kErr.message}`); return res }
  const knownRows = (known ?? []) as DriveFileRow[]
  const knownBy = new Map(knownRows.map(k => [`${k.bucket}|${k.object_path}`, k]))
  const storedKeys = new Set(stored.map(s => `${s.bucket}|${s.object_path}`))

  // 3. Copy new ones (oldest first), bounded.
  const todo = stored.filter(s => !knownBy.has(`${s.bucket}|${s.object_path}`)).sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, max)
  for (const s of todo) {
    try {
      if (s.size > 20 * 1024 * 1024) throw new Error('over 20 MB — skipped')
      const { data: blob, error } = await sb.storage.from(s.bucket).download(s.object_path)
      if (error || !blob) throw new Error(error?.message ?? 'download failed')
      const bytes = Buffer.from(await blob.arrayBuffer())
      const place = await placeFor(sb, s.bucket, s.object_path, new Date(s.created_at))
      const folderId = await ensureFolderPath(cfg, place.segments)
      const up = await uploadFile(cfg, folderId, place.name, mimeFor(place.name), bytes, `CT Hub · ${s.bucket}/${s.object_path}`)
      await sb.from('drive_files').upsert({
        bucket: s.bucket, object_path: s.object_path, drive_id: up.id, drive_folder_id: folderId,
        drive_path: [...place.segments, place.name].join('/'), file_name: place.name, uploaded_at: new Date().toISOString(), error: null,
      }, { onConflict: 'bucket,object_path' })
      res.copied++
    } catch (e) {
      res.failed++
      const msg = e instanceof Error ? e.message : String(e)
      res.errors.push(`${s.bucket}/${s.object_path}: ${msg}`)
      await sb.from('drive_files').upsert({ bucket: s.bucket, object_path: s.object_path, error: msg }, { onConflict: 'bucket,object_path' })
    }
  }

  // 4. Objects gone from Storage → move their Drive copy under Archive/.
  for (const k of knownRows) {
    if (k.archived_at || !k.drive_id || !k.drive_folder_id || !k.drive_path) continue
    if (storedKeys.has(`${k.bucket}|${k.object_path}`)) continue
    try {
      const segs = k.drive_path.split('/'); const name = segs.pop()!
      const archFolder = await ensureFolderPath(cfg, [ARCHIVE_ROOT, ...segs])
      const dot = name.lastIndexOf('.')
      const newName = dot > 0 ? `${name.slice(0, dot)}__deleted-${istStamp().slice(0, 10)}${name.slice(dot)}` : `${name}__deleted-${istStamp().slice(0, 10)}`
      await moveFile(cfg, k.drive_id, k.drive_folder_id, archFolder, newName)
      await sb.from('drive_files').update({ archived_at: new Date().toISOString(), drive_folder_id: archFolder, drive_path: [ARCHIVE_ROOT, ...segs, newName].join('/'), file_name: newName }).eq('id', k.id)
      res.moved++
    } catch (e) {
      res.failed++; res.errors.push(`archive ${k.bucket}/${k.object_path}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return res
}

export { type DriveConfig }
