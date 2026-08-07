// PM / Head approve or flag JMR daily entries.
//
// Body: { ids: string[], action: 'approve' | 'flag', remarks?: string }
//
// - Approve: status → 'pm_approved', sets approved_by_user_id + approved_at,
//            stores the reviewer's comment in `review_remarks`.
// - Flag:    status → 'flagged', sets approved_by_user_id + approved_at, and
//            stores the reason in `review_remarks`.
//
// A comment is REQUIRED for both approve and flag — every review leaves an
// auditable note against the entry.
//
// The approver note lives in its own column, distinct from the engineer's
// work_description, so neither field mutates the other.
//
// After a successful review, the engineer who logged each entry is notified
// (in-app bell + their chosen channels via notify_user) — grouped into one
// message per person, and never firing for entries you reviewed of your own.
//
// Authorisation: RLS already restricts UPDATE on jmr_daily_entries to
// admin / head; non-privileged callers will simply get 0 rows updated.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'
import { formatDateIN } from '@/lib/jmr/format'

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
  if (!remarks) {
    return NextResponse.json(
      { error: isFlag ? 'A comment is required when flagging.' : 'A comment is required to approve.' },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Single bulk UPDATE — the reviewer's comment goes to its own column,
  // required for every approve/flag so each entry keeps an auditable note.
  const patch: Record<string, unknown> = {
    status: isFlag ? 'flagged' : 'pm_approved',
    approved_by_user_id: user.id,
    approved_at: new Date().toISOString(),
    review_remarks: remarks,
  }

  const { data, error } = await supabase
    .from('jmr_daily_entries')
    .update(patch)
    .in('id', body.ids)
    .eq('status', 'submitted') // only re-affect entries still in the inbox
    .select('id, logged_by_user_id, entry_date, jmr_items(name)')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<{
    id: string
    logged_by_user_id: string | null
    entry_date: string
    jmr_items: { name: string } | { name: string }[] | null
  }>

  // ── Notify each engineer whose entries were just reviewed ───────────────
  // One grouped message per person; skip entries you reviewed of your own.
  // notify_user is SECURITY DEFINER, so it posts to the engineer's inbox and
  // rides their channel prefs + the /admin/notifications policy. A notify
  // failure never fails the approval itself (the DB write already landed).
  const byEngineer = new Map<string, typeof rows>()
  for (const r of rows) {
    const uid = r.logged_by_user_id
    if (!uid || uid === user.id) continue
    const arr = byEngineer.get(uid) ?? []
    arr.push(r)
    byEngineer.set(uid, arr)
  }

  const notifyErrors: string[] = []
  for (const [engineerId, mine] of byEngineer) {
    const n = mine.length
    const first = mine[0]!
    const itemName = Array.isArray(first.jmr_items) ? first.jmr_items[0]?.name : first.jmr_items?.name
    const dateHuman = formatDateIN(first.entry_date)
    const title = isFlag
      ? (n === 1 ? `JMR flagged · ${itemName ?? dateHuman}` : `${n} JMR entries flagged`)
      : (n === 1 ? `JMR approved · ${itemName ?? dateHuman}` : `${n} JMR entries approved`)
    const lead = isFlag
      ? (n === 1 ? `Your ${dateHuman} entry needs a re-check.` : `${n} of your entries were flagged.`)
      : (n === 1 ? `Your ${dateHuman} entry was approved.` : `${n} of your entries were approved.`)
    const { error: nerr } = await supabase.rpc('notify_user', {
      p_user_id: engineerId,
      p_type: isFlag ? 'jmr_entry_flagged' : 'jmr_entry_approved',
      p_title: title,
      p_body: `${lead} ${isFlag ? 'Reason' : 'Note'}: ${remarks}`,
      p_url: '/jmr/my',
      p_module_slug: 'jmr',
      p_doc_table: 'jmr_daily_entries',
      p_doc_id: n === 1 ? first.id : null,
      p_data: { action: body.action, count: n, ids: mine.map(m => m.id), remarks },
    })
    if (nerr) notifyErrors.push(`${engineerId}: ${nerr.message}`)
  }

  return NextResponse.json({
    updated: rows.length,
    action: body.action,
    notified: byEngineer.size,
    ...(notifyErrors.length ? { notifyErrors } : {}),
  })
}
