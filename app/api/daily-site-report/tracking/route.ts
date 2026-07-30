// Saves the Atm-Head follow-up state (note / flag / follow-up date) for a
// site report. Uses the caller's session client so RLS enforces the
// management-only write policy on dsr_tracking (engineers can't write here).

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const perms = await getMyPermissions()
  if (!can(perms, 'daily-site-report', 'edit')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — tracking edit permission required' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'Invalid JSON' }, { status: 400 })
  }

  const reportId = typeof body.reportId === 'string' ? body.reportId.trim() : ''
  if (!reportId) {
    return NextResponse.json({ ok: false, reason: 'reportId is required' }, { status: 400 })
  }

  const row: Record<string, unknown> = { report_id: reportId, updated_at: new Date().toISOString() }
  const user = await getMyUser()
  if (user) row.updated_by = user.id
  if (typeof body.head_note === 'string') row.head_note = body.head_note.slice(0, 500)
  if (typeof body.flagged === 'boolean') row.flagged = body.flagged
  if (typeof body.follow_up_on === 'string') row.follow_up_on = body.follow_up_on || null
  else if (body.follow_up_on === null) row.follow_up_on = null

  const supabase = await createClient()
  const { error } = await supabase
    .from('dsr_tracking')
    .upsert(row, { onConflict: 'report_id' })

  if (error) {
    return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
