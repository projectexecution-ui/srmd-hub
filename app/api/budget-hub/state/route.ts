// Live storage for the Budget Hub's JSON blob — replaces what used to be
// trapped in each browser's localStorage. GET returns the org-wide state,
// PUT writes a new version and snapshots the previous one.
//
// The Budget Hub HTML (public/budget-hub.html) talks to this on load and on
// every save, so the whole team sees the same numbers.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

const STATE_ID = 'global'
// Cap a single payload at 8 MB so a runaway Excel paste can't poison the DB.
const MAX_BYTES = 8 * 1024 * 1024

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data, error } = await supabase
    .from('budget_hub_state')
    .select('state, version, updated_at, updated_by')
    .eq('id', STATE_ID)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Resolve updater name (best-effort — UI just shows "—" if unknown)
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

  // Optimistic concurrency: client passes the version it loaded; if a teammate
  // has written since, we 409. Client can re-fetch and retry, or pass force=true.
  const { data: current, error: readErr } = await supabase
    .from('budget_hub_state')
    .select('state, version')
    .eq('id', STATE_ID)
    .single()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })

  if (!body.force && typeof body.baseVersion === 'number' && body.baseVersion !== current.version) {
    return NextResponse.json(
      { error: 'version_conflict', server_version: current.version },
      { status: 409 },
    )
  }

  // Snapshot the OLD state to history before overwriting
  const { error: snapErr } = await supabase
    .from('budget_hub_state_history')
    .insert({
      state_id: STATE_ID,
      state: current.state,
      version: current.version,
      snapshot_by: user.id,
    })
  if (snapErr) {
    // History is best-effort; don't block the write
    console.warn('[budget-hub] snapshot failed:', snapErr.message)
  }

  const newVersion = current.version + 1
  const { error: updErr } = await supabase
    .from('budget_hub_state')
    .update({
      state: body.state,
      version: newVersion,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('id', STATE_ID)

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  // ── Auto-pull mapped CT Hub projects ────────────────────────────────
  // After the BPH state is saved, run a sync for every saved BPH↔CT
  // mapping so the Cost Control module's Approved Budget (ERP) tiles
  // stay fresh without the PM clicking through each project.
  //
  // Best-effort: failures get returned but never block the save. The
  // BPH UI shows "n synced / m failed" in a chip after the response.
  let autoSync: { ran_at: string; ok_count: number; err_count: number; outcomes: unknown[] } | null = null
  try {
    const { runAllMappedPulls } = await import('@/app/(app)/cost-control/import/bph/actions')
    // Run the mapped-link sync with ELEVATED rights so the Internal Estimate
    // refreshes no matter WHO uploaded the BPH report — Parimal (Coordinator),
    // an `uploader`-role person, anyone. Without this the pull uses the
    // uploader's session and is skipped for non-cost-control-edit users (and
    // RLS would block their writes), so their uploads only synced on the
    // twice-daily cron. The saved BPH↔CT link is the authorization (a CC admin
    // set it up); the pull is code-match-only, idempotent, and gated by the
    // cc_bph_sync setting. actorId attributes the audit events to the uploader.
    // Falls back to the caller's session if the service key is ever missing.
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const svc = serviceKey
      ? createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } })
      : null
    const r = await runAllMappedPulls(svc ? { client: svc, actorId: user.id } : undefined)
    autoSync = {
      ran_at: r.ran_at,
      ok_count: r.outcomes.filter(o => o.ok).length,
      err_count: r.outcomes.filter(o => !o.ok).length,
      outcomes: r.outcomes,
    }
  } catch (e) {
    console.warn('[budget-hub] auto-pull failed:', e instanceof Error ? e.message : e)
  }

  return NextResponse.json({ ok: true, version: newVersion, autoSync })
}
