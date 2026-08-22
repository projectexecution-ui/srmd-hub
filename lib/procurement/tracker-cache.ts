import { unstable_cache, revalidateTag } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'

/** Cached read of the Indent → PO tracker blobs.
 *
 *  Why: procurement_tracker_state holds ~803 kB of JSON across two slots
 *  ('global' = the Indent-to-Issue report, 'po' = the PO report) carrying 4,543
 *  lines between them. Four separate hot paths were fetching and parsing all of
 *  it from scratch — the tracker's own state route on every page visit, the
 *  Warehouse PO screen and the Warehouse sync page on every render, and the
 *  tracker admin page. It is six times the budget blob that was already costing
 *  the most CPU in the app.
 *
 *  Safe to share ONE entry across users. Both slots are org-wide: the state
 *  route serves the identical payload to everybody and only gates entry with
 *  requirePermission, while per-user project hiding happens in the browser from
 *  a separate app_settings value. The permission check stays OUTSIDE the cache.
 *
 *  Uses a service-role client because an unstable_cache callback must not read
 *  cookies, and the request-scoped Supabase client does.
 */
export const TRACKER_TAG = 'procurement-tracker-state'

export type TrackerSlot = {
  id: string
  state: unknown
  version: number
  updatedAt: string
  updatedByName: string | null
}

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchSlots(sb: any): Promise<TrackerSlot[]> {
  // Ordered by id so the slots always come back in the same sequence — anything
  // that takes the FIRST value it sees for an item (its unit) would otherwise
  // differ between two runs over identical data.
  const { data, error } = await sb
    .from('procurement_tracker_state')
    .select('id, state, version, updated_at, updated_by')
    .in('id', ['global', 'po'])
    .order('id')
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Array<{
    id: string; state: unknown; version: number; updated_at: string; updated_by: string | null
  }>

  // Resolve updater names in one query rather than per slot.
  const ids = [...new Set(rows.map(r => r.updated_by).filter((x): x is string => !!x))]
  const nameById = new Map<string, string>()
  if (ids.length > 0) {
    const { data: profs } = await sb.from('profiles').select('id, full_name, email').in('id', ids)
    for (const p of (profs ?? []) as Array<{ id: string; full_name: string | null; email: string }>) {
      nameById.set(p.id, p.full_name ?? p.email ?? '')
    }
  }

  return rows.map(r => ({
    id: r.id,
    state: r.state,
    version: r.version,
    updatedAt: r.updated_at,
    updatedByName: r.updated_by ? nameById.get(r.updated_by) ?? null : null,
  }))
}

const cached = unstable_cache(
  async (): Promise<TrackerSlot[]> => fetchSlots(serviceClient()),
  ['procurement-tracker-state'],
  {
    tags: [TRACKER_TAG],
    // The source is a MANUAL weekly upload, so an hour is already far fresher
    // than the data. The tag is what keeps it correct; this is only a backstop
    // for a write path that ever forgets to invalidate.
    revalidate: 3600,
  },
)

/** Both slots, from cache. `fallbackClient` is used when there is no service
 *  key (local envs) so a misconfigured environment is slow, not broken. */
export async function getTrackerSlots(fallbackClient?: unknown): Promise<TrackerSlot[]> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!fallbackClient) throw new Error('tracker-cache: no service key and no fallback client')
    return fetchSlots(fallbackClient)
  }
  return cached()
}

/** One slot by id, or null. */
export async function getTrackerSlot(id: 'global' | 'po', fallbackClient?: unknown): Promise<TrackerSlot | null> {
  const slots = await getTrackerSlots(fallbackClient)
  return slots.find(s => s.id === id) ?? null
}

/** Call after ANY write to procurement_tracker_state.
 *
 *  `{ expire: 0 }` rather than the recommended 'max': 'max' only marks the entry
 *  stale and serves the PREVIOUS upload to the next viewer while a fresh one
 *  loads behind them. Straight after an IN4 upload that is the wrong answer.
 *  updateTag() would be tidier but is Server-Action-only, and the writer here is
 *  a Route Handler. */
export function revalidateTrackerSoon(): void {
  revalidateTag(TRACKER_TAG, { expire: 0 })
}
