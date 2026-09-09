'use server'

import { requirePermission } from '@/lib/auth'
import { loadOrderLineRates, type OrderLineRates } from '@/lib/revamp/line-rates'

/**
 * The "what did we pay last time?" lookup for one order's lines, called lazily
 * from the tree when a line's rate history is opened. Read-only; gated on the
 * same permission the WO/PO tab is (cost-control view). Never throws — the
 * loader returns an in4 state the panel can explain.
 */
export async function fetchOrderLineRates(kind: 'wo' | 'po', in4Id: number | null, ref?: string | null): Promise<OrderLineRates> {
  await requirePermission('cost-control', 'view')
  if (kind !== 'wo' && kind !== 'po') return { kind: 'po', lines: [], in4: 'unavailable', error: 'bad kind' }
  return loadOrderLineRates(kind, in4Id, ref)
}
