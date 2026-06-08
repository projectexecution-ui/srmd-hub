// Read-only "who am I?" probe for the Budget Hub iframe. The iframe runs
// inside /budget-hub.html (static asset) and needs to know whether the
// viewer is a Portal Owner so it can decide whether to show destructive
// controls like "Reset All". Intentionally minimal — no DB writes, no
// access to budget state.

import { NextResponse } from 'next/server'
import { isPortalOwner } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const portalOwner = await isPortalOwner()
  return NextResponse.json({ portalOwner })
}
