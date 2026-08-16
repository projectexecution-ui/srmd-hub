// Saves the per-bill "trust desk" entry (submission/courier date, remark,
// account override, adjust-advance flag) for the auto Daily Bills Report.
// Uses the caller's session client so RLS enforces bills-pipeline / stuck-bills edit.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

  const billId = typeof body.billId === 'string' ? body.billId.trim() : ''
  if (!billId) {
    return NextResponse.json({ ok: false, reason: 'billId is required' }, { status: 400 })
  }

  const row: Record<string, unknown> = { bill_id: billId, updated_at: new Date().toISOString() }
  const user = await getMyUser()
  if (user) row.updated_by = user.id

  // Date fields — accept 'YYYY-MM-DD', clear on empty/null.
  for (const f of ['submission_date', 'courier_date'] as const) {
    if (f in body) row[f] = typeof body[f] === 'string' && body[f] ? body[f] : null
  }
  if ('remark' in body) row.remark = typeof body.remark === 'string' && body.remark ? body.remark.slice(0, 200) : null
  if ('account' in body) row.account = typeof body.account === 'string' && body.account ? body.account.toUpperCase().slice(0, 12) : null
  if (typeof body.is_adjust_advance === 'boolean') row.is_adjust_advance = body.is_adjust_advance
  if ('highlight' in body) row.highlight = body.highlight === 'red' || body.highlight === 'yellow' ? body.highlight : null

  const supabase = await createClient()
  const { error } = await supabase
    .from('bp_bill_trustdesk')
    .upsert(row, { onConflict: 'bill_id' })

  if (error) {
    return NextResponse.json({ ok: false, reason: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
