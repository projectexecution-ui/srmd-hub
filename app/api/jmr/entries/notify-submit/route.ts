// Instant "there's a JMR entry to review" ping to the approvers, fired by the
// entry form right after a successful submit.
//
// Body: { entryId: string }
//
// Audience: active admin + head profiles (the roles the jmr_daily_entries
// UPDATE policy lets approve/flag) — never the logging engineer themselves.
// Delivery rides notify_user() → each approver's channel prefs + the
// /admin/notifications policy. (Email is defaulted OFF for this event via a
// global notification_rules row so busy days don't flood inboxes; in-app +
// phone push stay on. Flip email on from the Notifications admin page.)
//
// This lives in a route (not a DB trigger) on purpose: only interactive form
// submits call it, so a bulk import/back-fill never triggers a notification
// storm. It only acts on the caller's OWN freshly-submitted row.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyPermissions, getMyProfile, can } from '@/lib/auth'
import { formatDateIN } from '@/lib/jmr/format'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Rel<T> = T | T[] | null
function unwrap<T>(v: Rel<T>): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

export async function POST(req: NextRequest) {
  const [perms, profile] = await Promise.all([getMyPermissions(), getMyProfile()])
  if (!can(perms, 'jmr', 'edit')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let entryId: string | undefined
  try { entryId = ((await req.json()) as { entryId?: string })?.entryId } catch { /* bad body */ }
  if (!entryId) return NextResponse.json({ error: 'entryId required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  // Load through the caller's RLS; only notify for their OWN just-submitted row.
  const { data: entryRaw } = await supabase
    .from('jmr_daily_entries')
    .select(`
      id, status, logged_by_user_id, entry_date, project_id,
      jmr_items ( name ),
      jmr_contractors ( name ),
      projects!jmr_daily_entries_project_id_fkey ( code, name ),
      sub_project:projects!jmr_daily_entries_sub_project_id_fkey ( code, name )
    `)
    .eq('id', entryId)
    .maybeSingle()

  const entry = entryRaw as {
    id: string
    status: string
    logged_by_user_id: string | null
    entry_date: string
    project_id: string
    jmr_items: Rel<{ name: string }>
    jmr_contractors: Rel<{ name: string }>
    projects: Rel<{ code: string | null; name: string }>
    sub_project: Rel<{ code: string | null; name: string }>
  } | null

  if (!entry || entry.status !== 'submitted' || entry.logged_by_user_id !== user.id) {
    return NextResponse.json({ notified: 0, skipped: 'not-a-fresh-own-submission' })
  }

  // Fan out with the service role so we can read every approver's profile and
  // post to their inbox regardless of the caller's RLS.
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!svcKey || !svcUrl) return NextResponse.json({ notified: 0, skipped: 'no-service-key' })
  const svc = createServiceClient(svcUrl, svcKey, { auth: { persistSession: false } })

  const { data: approvers } = await svc
    .from('profiles')
    .select('id')
    .in('role', ['admin', 'head'])
    .neq('id', user.id)
    .or('is_active.is.null,is_active.eq.true')

  const item = unwrap(entry.jmr_items)?.name ?? 'an entry'
  const ctr = unwrap(entry.jmr_contractors)?.name ?? ''
  const proj = unwrap(entry.projects)
  const sub = unwrap(entry.sub_project)
  const projLabel = sub?.code || sub?.name || proj?.code || proj?.name || ''
  const eng = profile?.full_name ?? profile?.email ?? 'A site engineer'
  const dateHuman = formatDateIN(entry.entry_date)

  let notified = 0
  const errors: string[] = []
  for (const a of (approvers ?? []) as Array<{ id: string }>) {
    const { error } = await svc.rpc('notify_user', {
      p_user_id: a.id,
      p_type: 'jmr_entry_submitted',
      p_title: `JMR to review${projLabel ? ` · ${projLabel}` : ''}`,
      p_body: `${eng} logged ${item}${ctr ? ` (${ctr})` : ''} for ${dateHuman}. Review it in the JMR dashboard.`,
      p_url: '/jmr/dashboard',
      p_module_slug: 'jmr',
      p_doc_table: 'jmr_daily_entries',
      p_doc_id: entry.id,
      p_data: { entryId: entry.id, projectId: entry.project_id },
    })
    if (error) errors.push(`${a.id}: ${error.message}`)
    else notified++
  }

  return NextResponse.json({ notified, ...(errors.length ? { errors } : {}) })
}
