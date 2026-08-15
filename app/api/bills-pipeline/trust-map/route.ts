// Saves the project → trust map for the Daily Bills Report. Each project
// (task-list name) is filed under one trust (SRET / SRAH / SRASSK / SRA); the
// map lives in app_settings['bills_pipeline_trust_map'] as { [project]: trust }.
// Uses the caller's session client so RLS enforces bills-pipeline edit.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY = 'bills_pipeline_trust_map'
const ACCOUNTS = new Set(['SRET', 'SRAH', 'SRASSK', 'SRA'])

export async function POST(req: NextRequest) {
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-pipeline', 'edit') && !can(perms, 'stuck-bills', 'edit')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — bills edit permission required' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'Invalid JSON' }, { status: 400 })
  }

  const area = typeof body.area === 'string' ? body.area.trim() : ''
  const trustRaw = typeof body.trust === 'string' ? body.trust.trim().toUpperCase() : ''
  if (!area) return NextResponse.json({ ok: false, reason: 'area is required' }, { status: 400 })
  if (trustRaw && !ACCOUNTS.has(trustRaw)) {
    return NextResponse.json({ ok: false, reason: 'unknown trust' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: cur } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle()

  let map: Record<string, string> = {}
  if (cur?.value) { try { map = JSON.parse(cur.value as string) as Record<string, string> } catch { map = {} } }

  if (trustRaw) map[area] = trustRaw; else delete map[area]

  const { error } = await supabase.from('app_settings').upsert(
    { key: KEY, value: JSON.stringify(map), updated_at: new Date().toISOString() },
    { onConflict: 'key' },
  )
  if (error) return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
