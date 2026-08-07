// PM / Head approve or flag JMR daily entries.
//
// Body: { ids: string[], action: 'approve' | 'flag', remarks?: string }
//
// - Approve: status → 'pm_approved', sets approved_by_user_id + approved_at.
//            If `remarks` is provided, they are stored in `review_remarks`
//            (the approver's note) so the engineer sees it on /jmr/my without
//            touching their own work_description. Remarks optional on approve.
// - Flag:    status → 'flagged', sets approved_by_user_id + approved_at, and
//            stores the reason in `review_remarks`. Remarks REQUIRED for flag.
//
// The approver note lives in its own column, distinct from the engineer's
// work_description, so neither field mutates the other.
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

  const isFlag = body.action === 'flag'
  const remarks = body.remarks?.trim() || null
  if (isFlag && !remarks) {
    return NextResponse.json({ error: 'Flagging requires remarks' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Single bulk UPDATE — the approver note goes to its own column. A plain
  // approve (no remarks, e.g. the bulk "Approve selected" button) leaves
  // review_remarks null; a per-row note or a flag reason is written through.
  const patch: Record<string, unknown> = {
    status: isFlag ? 'flagged' : 'pm_approved',
    approved_by_user_id: user.id,
    approved_at: new Date().toISOString(),
  }
  if (remarks) patch.review_remarks = remarks

  const { data, error } = await supabase
    .from('jmr_daily_entries')
    .update(patch)
    .in('id', body.ids)
    .eq('status', 'submitted') // only re-affect entries still in the inbox
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ updated: data?.length ?? 0, action: body.action })
}
