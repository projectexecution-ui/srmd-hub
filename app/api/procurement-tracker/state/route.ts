// GET /api/procurement-tracker/state
// Returns the latest shared org-wide procurement-tracker state (the
// parsed upload + metadata + line statuses) so the page can rehydrate
// the dashboard on mount. Mirrors /api/budget-hub/state.
//
// Response: { state: { ... }, version, updatedAt, updatedBy } | { state: null }

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET() {
  // Anyone with view perm on procurement-tracker can read.
  await requirePermission('procurement-tracker', 'view')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('procurement_tracker_state')
    .select('state, version, updated_at, updated_by')
    .eq('id', 'global')
    .maybeSingle()

  if (error) {
    console.error('[procurement] state fetch failed:', error)
    return NextResponse.json({ state: null }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ state: null })
  }

  // Look up the updater's name for the saved-by display.
  let updatedByName: string | null = null
  if (data.updated_by) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('id', data.updated_by)
      .maybeSingle()
    updatedByName = profile?.full_name ?? profile?.email ?? null
  }

  return NextResponse.json({
    state: data.state,
    version: data.version,
    updatedAt: data.updated_at,
    updatedByName,
  })
}
