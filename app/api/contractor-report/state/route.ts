// Server-backed state for the Contractor Report module — mirrors
// /api/budget-hub/state. GET returns the org-wide blob; PUT writes a new
// version and snapshots the previous one. The report page loads this on
// mount and saves on every upload, so the whole team shares one dataset.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const STATE_ID = 'global'
const MAX_BYTES = 8 * 1024 * 1024

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data, error } = await supabase
    .from('contractor_report_state')
    .select('state, version, updated_at, updated_by')
    .eq('id', STATE_ID)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let updatedByName: string | null = null
  if (data.updated_by) {
    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name, name')
      .eq('id', data.updated_by)
      .single()
    updatedByName = prof?.full_name ?? prof?.name ?? null
  }

  return NextResponse.json({
    state: data.state,
    version: data.version,
    updated_at: data.updated_at,
    updated_by_name: updatedByName,
  })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: { state?: unknown; baseVersion?: number; force?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || body.state == null) {
    return NextResponse.json({ error: 'state_required' }, { status: 400 })
  }

  const serialized = JSON.stringify(body.state)
  if (serialized.length > MAX_BYTES) {
    return NextResponse.json(
      { error: 'state_too_large', max_bytes: MAX_BYTES, got_bytes: serialized.length },
      { status: 413 },
    )
  }

  const { data: current, error: readErr } = await supabase
    .from('contractor_report_state')
    .select('state, version')
    .eq('id', STATE_ID)
    .single()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

  // Optimistic concurrency — client passes the version it loaded.
  if (!body.force && typeof body.baseVersion === 'number' && body.baseVersion !== current.version) {
    return NextResponse.json(
      { error: 'version_conflict', server_version: current.version },
      { status: 409 },
    )
  }

  // Snapshot the old state before overwriting (best-effort).
  const { error: snapErr } = await supabase
    .from('contractor_report_state_history')
    .insert({ state_id: STATE_ID, state: current.state, version: current.version, snapshot_by: user.id })
  if (snapErr) console.warn('[contractor-report] snapshot failed:', snapErr.message)

  const newVersion = current.version + 1
  const { error: updErr } = await supabase
    .from('contractor_report_state')
    .update({ state: body.state, version: newVersion, updated_at: new Date().toISOString(), updated_by: user.id })
    .eq('id', STATE_ID)

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, version: newVersion })
}
