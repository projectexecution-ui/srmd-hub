// GET /api/procurement-tracker/state
// Returns BOTH shared org-wide procurement slots so the page can rehydrate and
// merge them:
//   • indent = 'global' slot — the Indent-to-Issue report (Needs-PO source)
//   • po     = 'po' slot     — the PO report (accurate + priced)
//
// Response: { indent: Slot | null, po: Slot | null }
//   Slot = { state, version, updatedAt, updatedByName }
//
// The read is cached (see lib/procurement/tracker-cache.ts) — this used to fetch
// and serialise ~803 kB of JSON on every visit. The permission check stays out
// here, ahead of the cache, so gating is still per user.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { getTrackerSlots } from '@/lib/procurement/tracker-cache'

export const runtime = 'nodejs'

export async function GET() {
  await requirePermission('procurement-tracker', 'view')

  try {
    const slots = await getTrackerSlots(await createClient())
    const slot = (id: string) => {
      const r = slots.find(s => s.id === id)
      if (!r) return null
      return { state: r.state, version: r.version, updatedAt: r.updatedAt, updatedByName: r.updatedByName }
    }
    return NextResponse.json({ indent: slot('global'), po: slot('po') })
  } catch (e) {
    console.error('[procurement] state fetch failed:', e)
    return NextResponse.json({ indent: null, po: null }, { status: 500 })
  }
}
