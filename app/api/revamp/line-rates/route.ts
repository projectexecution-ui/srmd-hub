// "What did we pay last time?" for one order's lines — the WO/PO tree's Rate
// check reads this on demand.
//
// A GET on purpose, not a Server Action. The trial site's proxy refuses every
// non-GET request so nothing can write there (lib/demo-mode.ts, layer 1), and a
// Server Action travels as a POST — so a read-only lookup built as an action
// was 403'd on the preview before it ever reached IN4 (9 Sep 2026). A read
// should move like a read. Same permission as the WO/PO tab; SELECT only.

import { NextRequest, NextResponse } from 'next/server'
import { getMyPermissions, can } from '@/lib/auth'
import { loadOrderLineRates } from '@/lib/revamp/line-rates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'view')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden' }, { status: 403 })
  }

  const q = req.nextUrl.searchParams
  const kind = q.get('kind')
  if (kind !== 'wo' && kind !== 'po') {
    return NextResponse.json({ ok: false, reason: 'kind must be wo or po' }, { status: 400 })
  }
  const idRaw = q.get('id')
  const in4Id = idRaw != null && idRaw !== '' && /^\d+$/.test(idRaw) ? Number(idRaw) : null
  const ref = q.get('ref')?.trim() || null

  const data = await loadOrderLineRates(kind, in4Id, ref)
  return NextResponse.json({ ok: true, ...data })
}
