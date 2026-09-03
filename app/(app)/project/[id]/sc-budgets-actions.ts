'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { savedKeyFor, type SavedLayout } from '@/lib/revamp/sc-budgets'

export interface SaveResult { ok: boolean; message: string }

/**
 * Save this project's SC Budgets layout — the clubs, columns, unit, grouping.
 *
 * Gated on the SAME permission as the report itself (`budget-vs-actual-v2`,
 * admin / head / founder), so nobody who cannot read the report can rearrange
 * it for those who can.
 *
 * Stored in app_settings under one key per project. No new table, because the
 * database is shared with the live app and a migration is not a branch-only
 * change.
 */
export async function saveScLayout(projectId: string, layout: SavedLayout): Promise<SaveResult> {
  try {
    await requirePermission('budget-vs-actual-v2', 'view')
  } catch {
    return { ok: false, message: 'You do not have access to this report.' }
  }

  if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
    return { ok: false, message: 'That is not a project.' }
  }

  // Keep the stored blob small and predictable — only the fields the report
  // reads back, never whatever the client happened to hold.
  const clean: SavedLayout = {
    buckets: (layout.buckets ?? []).slice(0, 40).map((b, i) => ({
      id: String(b.id || `club-${i}`).slice(0, 40),
      name: String(b.name ?? '').trim().slice(0, 60),
      disciplineCodes: (b.disciplineCodes ?? []).map(String).slice(0, 200),
      subCodes: (b.subCodes ?? []).map(String).slice(0, 400),
    })),
    columns: layout.columns ?? [],
    unit: layout.unit,
    grouping: layout.grouping,
    pdfColumns: layout.pdfColumns ?? [],
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: savedKeyFor(projectId), value: JSON.stringify(clean) }, { onConflict: 'key' })

  if (error) {
    // The trial site blocks writes and resolves with this code rather than
    // throwing, so say what actually happened.
    if (error.code === 'DEMO_READ_ONLY') {
      return { ok: false, message: 'This is the trial site — the layout is not saved here.' }
    }
    // app_settings writes are admin-only at the database level, so a head or
    // the Trustee will land here. Worth saying plainly rather than showing a
    // raw Postgres message.
    if (error.code === '42501' || /row-level security/i.test(error.message)) {
      return { ok: false, message: 'Only an admin can save a layout. Ask Aksha to save it for everyone.' }
    }
    return { ok: false, message: error.message }
  }

  revalidatePath(`/project/${projectId}/sc-budgets`)
  return {
    ok: true,
    message: clean.buckets.length > 0
      ? `Saved for this project — ${clean.buckets.length} clubbed line${clean.buckets.length === 1 ? '' : 's'}.`
      : 'Saved for this project.',
  }
}
