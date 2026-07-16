// Central Recycle Bin helper (client side).
//
// `recycleDelete` replaces a hard `.delete()` in module UIs: it soft-deletes
// the row in place (stamps deleted_at) so it drops out of every list, and
// records a pointer in `recycle_bin` so Admin › Recycle Bin can restore it.
// Restore is a single RPC (`recycle_restore`) driven from the bin page.
//
// To wire a new module: (1) add deleted_at/deleted_by to its table + the
// table name to recycle_restore()'s whitelist (migration), (2) filter reads
// with `.is('deleted_at', null)`, (3) call recycleDelete() instead of delete().

import type { createClient } from '@/lib/supabase/client'

type Client = ReturnType<typeof createClient>

export interface RecycleDeleteInput {
  /** Table the row lives in — must be whitelisted in recycle_restore(). */
  sourceTable: string
  entityId: string
  /** Human category shown in the bin, e.g. 'Established rate'. */
  entityType: string
  /** The item's own name/label. */
  label: string
  /** Optional second line (party, project, rate…). */
  context?: string
  /** Module slug for grouping + icon in the bin UI. */
  moduleSlug?: string
  /** Extra columns to set on the source row alongside deleted_at — e.g.
   *  `{ is_active: false }` so operational reads that filter on is_active
   *  exclude it without needing a deleted_at filter everywhere. */
  alsoSet?: Record<string, unknown>
}

/** Soft-delete a row and index it in the central Recycle Bin.
 *  Returns an error message on failure, or null on success. */
export async function recycleDelete(supabase: Client, input: RecycleDeleteInput): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser()
  const uid = userData?.user?.id ?? null

  const { error: upErr } = await supabase
    .from(input.sourceTable)
    .update({ deleted_at: new Date().toISOString(), deleted_by: uid, ...(input.alsoSet ?? {}) })
    .eq('id', input.entityId)
  if (upErr) return upErr.message

  const { error: binErr } = await supabase.from('recycle_bin').insert({
    entity_type: input.entityType,
    source_table: input.sourceTable,
    entity_id: input.entityId,
    label: input.label,
    context: input.context ?? null,
    module_slug: input.moduleSlug ?? null,
    deleted_by: uid,
  })
  if (binErr) {
    // Roll back so the item isn't hidden-but-missing-from-bin.
    await supabase.from(input.sourceTable)
      .update({ deleted_at: null, deleted_by: null })
      .eq('id', input.entityId)
    return binErr.message
  }
  return null
}
