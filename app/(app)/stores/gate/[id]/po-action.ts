'use server'

import { requirePermission } from '@/lib/auth'
import { searchOrders, loadOrder } from '@/lib/stores/queries'

/**
 * The storekeeper's order picker, against the IN4 mirror.
 *
 * Server actions rather than a route: the client needs them on demand, and
 * they read the mirror only, never IN4 itself.
 *
 * The search runs on the server on purpose. IN4 holds 1,451 purchase orders;
 * shipping them to a phone to filter there would cost more than every other
 * thing on the page put together.
 */
export async function searchOrdersForEntry(
  query: string,
  party?: { name?: string | null; id?: number | null },
) {
  await requirePermission('cost-control', 'view')
  return searchOrders(query, { partyHint: party?.name ?? null, partyId: party?.id ?? null })
}

/** `exceptEntryId` is the entry being filled in now — its own lines must not
 *  count as "already received", or re-picking the order on a half-typed entry
 *  would tell the storekeeper they had over-delivered against themselves. */
export async function loadOrderForEntry(key: string, exceptEntryId?: string) {
  await requirePermission('cost-control', 'view')
  return loadOrder(key, exceptEntryId ?? null)
}
