// Saves the per-bill pre-approval checklist (Stuck Bills tab).
// Uses the caller's session client so RLS enforces the bills-pipeline edit perm.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FIELDS = ['ms_sheet', 'abstract_sheet', 'po_wo', 'drawing'] as const

export async function POST(req: NextRequest) {
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-pipeline', 'edit')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — bills-pipeline edit required' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, reason: 'Invalid JSON' }, { status: 400 })
  }

  const billId = typeof body.billId === 'string' ? body.billId.trim() : ''
  if (!billId) {
    return NextResponse.json({ ok: false, reason: 'billId is required' }, { status: 400 })
  }

  const row: Record<string, unknown> = { bill_id: billId, updated_at: new Date().toISOString() }
  const user = await getMyUser()
  if (user) row.updated_by = user.id
  for (const f of FIELDS) {
    if (typeof body[f] === 'boolean') row[f] = body[f]
  }
  if (typeof body.note === 'string') row.note = body.note.slice(0, 500)

  const supabase = await createClient()
  const { error } = await supabase
    .from('bp_bill_checklist')
    .upsert(row, { onConflict: 'bill_id' })

  if (error) {
    return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
