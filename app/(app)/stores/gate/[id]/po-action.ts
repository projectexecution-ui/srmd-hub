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
export async function searchOrdersForEntry(query: string) {
  await requirePermission('cost-control', 'view')
  return searchOrders(query)
}

export async function loadOrderForEntry(key: string) {
  await requirePermission('cost-control', 'view')
  return loadOrder(key)
}
