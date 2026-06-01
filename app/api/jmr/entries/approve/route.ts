// PM / Head approve or flag JMR daily entries.
//
// Body: { ids: string[], action: 'approve' | 'flag', remarks?: string }
//
// - Approve: status → 'pm_approved', sets approved_by_user_id + approved_at.
//            If `remarks` is provided, appends `[OK: <remarks>]` to
//            work_description so the engineer sees the approver's note
//            on /jmr/my. Remarks are optional for approve.
// - Flag:    status → 'flagged',    sets approved_by_user_id + approved_at,
//            appends `[FLAG: <remarks>]` to work_description so the engineer
//            sees the reason on /jmr/my (no new schema column needed).
//            Remarks are REQUIRED for flag.
//
// Authorisation: RLS already restricts UPDATE on jmr_daily_entries to
// admin / head; non-privileged callers will simply get 0 rows updated.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'

interface Body {
  ids: string[]
  action: 'approve' | 'flag'
  remarks?: string
}

export async function POST(req: NextRequest) {
  // Cheap pre-check; the real gate is RLS. Saves a round-trip when a
  // viewer accidentally hits this endpoint.
  const perms = await getMyPermissions()
  if (!can(perms, 'jmr', 'edit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 })
  }
  if (body.action !== 'approve' && body.action !== 'flag') {
    return NextResponse.json({ error: 'action must be approve or flag' }, { status: 400 })
  }
  if (body.action === 'flag' && !body.remarks?.trim()) {
    return NextResponse.json({ error: 'Flagging requires remarks' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // For both approve+remarks and flag we need to read existing work_description
  // to append the tag. Approve without remarks is the simple bulk-update path.
  if (body.action === 'approve' && !body.remarks?.trim()) {
    // Plain approve — no remarks to append, single bulk UPDATE.
    const { data, error } = await supabase
      .from('jmr_daily_entries')
      .update({
        status: 'pm_approved',
        approved_by_user_id: user.id,
        approved_at: new Date().toISOString(),
      })
      .in('id', body.ids)
      .eq('status', 'submitted') // only re-affect entries still in the inbox
      .select('id')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ updated: data?.length ?? 0, action: 'approve' })
  }

  // Approve-with-remarks OR flag — both append a bracketed tag to work_description.
  const isFlag = body.action === 'flag'
  const tagPrefix = isFlag ? 'FLAG' : 'OK'
  const tag = `[${tagPrefix}: ${body.remarks!.trim()}]`

  const { data: existing, error: fetchErr } = await supabase
    .from('jmr_daily_entries')
    .select('id, work_description, status')
    .in('id', body.ids)
    .eq('status', 'submitted')

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!existing || existing.length === 0) {
    return NextResponse.json({ updated: 0, action: body.action })
  }

  let updated = 0
  for (const row of existing) {
    const desc = (row.work_description as string | null) ?? ''
    const next = desc ? `${desc}\n${tag}` : tag
    const { error: upErr } = await supabase
      .from('jmr_daily_entries')
      .update({
        status: isFlag ? 'flagged' : 'pm_approved',
        approved_by_user_id: user.id,
        approved_at: new Date().toISOString(),
        work_description: next,
      })
      .eq('id', row.id as string)
    if (!upErr) updated++
  }
  return NextResponse.json({ updated, action: body.action })
}
