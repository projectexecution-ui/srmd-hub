// Keep the sync snapshot tables from growing without end.
//
// Every IN4 feed run (twice a day) and every manual upload inserts a full copy
// of the state into a *_history table. By 10 Sep 2026 that was 81 MB for the
// (since removed) tracker alone — 157 snapshots nobody would ever read. The clean-up trimmed
// each table to its last 30 rows; this keeps it there.

import type { SupabaseClient } from '@supabase/supabase-js'

export const HISTORY_KEEP = 30

/** Delete every row beyond the newest `keep`, ordered by `orderCol`. Best effort — a failure here must never fail the sync. */
export async function pruneHistory(
  sb: Pick<SupabaseClient, 'from'>,
  table: 'budget_hub_state_history' | 'contractor_report_state_history' | 'supplier_report_state_history',
  orderCol: 'snapshot_at' | 'created_at',
  keep: number = HISTORY_KEEP,
): Promise<number> {
  try {
    const { data, error } = await sb.from(table).select('id').order(orderCol, { ascending: false, nullsFirst: false }).range(keep, keep + 999)
    if (error || !data?.length) return 0
    const ids = (data as Array<{ id: string | number }>).map(r => r.id)
    const { error: delErr } = await sb.from(table).delete().in('id', ids)
    return delErr ? 0 : ids.length
  } catch {
    return 0
  }
}
