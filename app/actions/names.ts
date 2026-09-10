'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { NameKind, NameScope } from '@/lib/names'

/**
 * Save (or clear) one CT Hub display name at one scope. The permission check —
 * admin, Portal Owner, or a name in app_settings.cthub_namers — runs inside the
 * SECURITY DEFINER RPC, so this action cannot widen it. A blank display clears.
 *
 * A Server Action is right here because this is a WRITE; the trial site's
 * proxy refuses it, which is exactly what the trial is for.
 */
export async function saveCthubName(input: {
  kind: NameKind
  key: string
  scope: NameScope
  scopeId?: string | null
  display: string
  note?: string | null
  /** For cache invalidation: the project whose screens show this name. */
  projectId?: string | null
}): Promise<{ ok: boolean; error?: string; cleared?: boolean }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('set_cthub_name', {
    p_kind: input.kind,
    p_key: input.key,
    p_scope: input.scope,
    p_scope_id: input.scope === 'all' ? '' : (input.scopeId ?? ''),
    p_display: input.display,
    p_note: input.note ?? null,
  })
  if (error) return { ok: false, error: error.message }
  const res = (data ?? {}) as { ok?: boolean; cleared?: boolean }
  // A rename shows on many screens; a rename is rare. Refresh broadly.
  if (input.projectId) revalidatePath(`/project/${input.projectId}`, 'layout')
  revalidatePath('/project', 'layout')
  revalidatePath('/procurement-tracker')
  return { ok: true, cleared: !!res.cleared }
}
