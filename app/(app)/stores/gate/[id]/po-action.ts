'use server'

import { requirePermission } from '@/lib/auth'
import { loadPoLines } from '@/lib/stores/queries'

/**
 * Look up one PO in the IN4 mirror, for the storekeeper's "Fill from IN4".
 *
 * A thin server action rather than a route: the client needs it on demand and
 * it reads the mirror only, never IN4 itself.
 */
export async function loadPoForEntry(poNo: string) {
  await requirePermission('cost-control', 'view')
  return loadPoLines(poNo)
}
