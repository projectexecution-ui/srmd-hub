'use client'

import { createClient } from '@/lib/supabase/client'
import { photoPath, type PhotoKind } from '@/lib/stores/photos'
import { recordPhotos } from '@/lib/stores/actions'

export interface PendingShot {
  kind: PhotoKind
  file: File
}

/**
 * Put the photographs in the bucket, then record them against the entry.
 *
 * The bytes go straight from the browser to Supabase storage rather than
 * through a server action: a server action carries its payload in the POST
 * body, and several photographs of a challan would be a multi-megabyte
 * round-trip through the Next server for no reason. Only the paths come back
 * through the server, which is also where the rows are written so the audit
 * columns are stamped the same way as everything else.
 *
 * NEVER throws. A gate entry that saved must not be undone because the phone
 * lost signal half way through the second photograph — the entry is the record
 * that matters, the photographs support it. What failed is returned so the
 * screen can say so and offer to try again.
 */
export async function uploadEntryPhotos(
  entryId: string,
  shots: readonly PendingShot[],
): Promise<{ saved: number; failed: number }> {
  if (shots.length === 0) return { saved: 0, failed: 0 }

  const supabase = createClient()
  const done: Array<{ kind: PhotoKind; path: string }> = []
  let failed = 0

  for (const s of shots) {
    const path = photoPath(entryId, s.kind, s.file.name || 'photo.jpg')
    const { error } = await supabase.storage
      .from('mio-photos')
      .upload(path, s.file, { contentType: s.file.type || 'image/jpeg', upsert: false })
    if (error) { failed++; continue }
    done.push({ kind: s.kind, path })
  }

  if (done.length > 0) {
    const r = await recordPhotos(entryId, done)
    // The bytes are in the bucket but the row is not; count it as failed so
    // the screen does not claim a photograph is on the record when it is not.
    if (!r.ok) return { saved: 0, failed: shots.length }
  }
  return { saved: done.length, failed }
}
