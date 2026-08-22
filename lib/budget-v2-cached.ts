import { unstable_cache, revalidateTag } from 'next/cache'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { loadBudgetV2, type BudgetV2LoadResult } from './budget-v2-load'

/** Cached read of the Budget-vs-Actual source.
 *
 *  Why this exists: budget_hub_state is a 137 kB JSON blob and every page that
 *  shows the tree was parsing it AND recomposing the whole hierarchy in
 *  TypeScript on every single request. 133 of 142 pages are force-dynamic, so
 *  nothing was reused between two people opening the same screen seconds apart.
 *  That parse-and-compose is pure CPU with no I/O to hide behind, which made it
 *  the most CPU-dense thing in the app.
 *
 *  Safe to share one cache entry across users: the blob is `id = 'global'` and
 *  the four side tables (status / area / extra / override) are global config
 *  too. Nothing here varies per user, and every page that renders it is already
 *  permission-gated before it is called.
 *
 *  It builds its own SERVICE-ROLE client on purpose. An unstable_cache callback
 *  must not touch cookies or headers, and the request-scoped Supabase client
 *  reads auth cookies — passing that in would throw at runtime.
 *
 *  Note on the API: `use cache` supersedes unstable_cache in Next 16, but it
 *  requires the app-wide `cacheComponents` flag, which changes static/dynamic
 *  behaviour across all 133 dynamic pages. Not a change to make as a side
 *  effect of a CPU fix — this stays on the documented previous model.
 */
export const BUDGET_V2_TAG = 'budget-v2-source'

function serviceClient() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const cached = unstable_cache(
  async (): Promise<BudgetV2LoadResult> => loadBudgetV2(serviceClient()),
  ['budget-v2-source'],
  {
    tags: [BUDGET_V2_TAG],
    // The source is a MANUAL weekly upload, so an hour is already far fresher
    // than the data. The tag below is what actually keeps it correct; this is
    // only a backstop in case a write path is ever added that forgets to
    // revalidate.
    revalidate: 3600,
  },
)

/** The tree, from cache. Falls through to a direct read if the service key is
 *  missing (local envs), so a misconfigured environment degrades to "slow"
 *  rather than "broken". */
export async function getBudgetV2(
  fallbackClient?: unknown,
): Promise<BudgetV2LoadResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!fallbackClient) throw new Error('budget-v2: no service key and no fallback client')
    return loadBudgetV2(fallbackClient)
  }
  return cached()
}

/** Invalidate after any write to budget_hub_state.
 *
 *  Next 16 requires a cache-life profile. 'max' would only mark the entry
 *  stale — the next viewer gets served the PREVIOUS upload while a fresh one
 *  loads behind them, which is precisely wrong right after you have uploaded a
 *  new BPH file. `{ expire: 0 }` expires it outright instead.
 *
 *  updateTag() would be the tidier API but it is Server-Action-only, and the
 *  Budget Hub is a static HTML iframe posting to a Route Handler, so it is not
 *  available on the path that actually matters here.
 */
export function revalidateBudgetV2Soon(): void {
  revalidateTag(BUDGET_V2_TAG, { expire: 0 })
}
