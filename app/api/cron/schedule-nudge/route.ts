// Schedule promise nudges — rides the cron dispatcher ('each' policy):
//   am slot, Mondays only  → "your week's promises" plan ping
//   pm slot, every day     → "still open" evening reminder
// Recipients = owners of this week's open promises (owner_name matched to an
// active profile). Delivery via notify_user() → native queue, so each person
// and the admin /admin/notifications toggle control email.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IST = 5.5 * 3_600_000
function istNow() { return new Date(Date.now() + IST) }
function istDate() { return istNow().toISOString().slice(0, 10) }
function weekStart(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  const back = d.getUTCDay() === 0 ? 6 : d.getUTCDay() - 1
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'no service key' }, { status: 500 })
  const sb = createServiceClient(url, key, { auth: { persistSession: false } })

  const slot = new URL(req.url).searchParams.get('slot') === 'pm' ? 'pm' : 'am'
  const today = istDate()
  const isMonday = istNow().getUTCDay() === 1
  if (slot === 'am' && !isMonday) return NextResponse.json({ ok: true, skipped: 'am runs Mondays only' })

  const monday = weekStart(today)
  const { data: proms } = await sb.from('sched_promises')
    .select('project_id, item_id, location, status, owner_name')
    .eq('week_start', monday).eq('status', 'open')
  const open = (proms ?? []) as Array<{ project_id: string; item_id: string; location: string; owner_name: string | null }>
  if (!open.length) return NextResponse.json({ ok: true, sent: 0, note: 'no open promises' })

  const [{ data: items }, { data: projects }, { data: profiles }] = await Promise.all([
    sb.from('sched_items').select('id, name, trade').in('id', Array.from(new Set(open.map(p => p.item_id)))),
    sb.from('projects').select('id, code, name'),
    sb.from('profiles').select('id, full_name, name, is_active'),
  ])
  const itemOf = new Map(((items ?? []) as Array<{ id: string; name: string; trade: string }>).map(i => [i.id, i]))
  const projOf = new Map(((projects ?? []) as Array<{ id: string; code: string | null; name: string }>).map(p => [p.id, p.code || p.name]))
  const userByName = new Map(((profiles ?? []) as Array<{ id: string; full_name: string | null; name: string | null; is_active: boolean | null }>)
    .filter(p => p.is_active !== false)
    .flatMap(p => [p.full_name, p.name].filter(Boolean).map(n => [String(n).trim().toLowerCase(), p.id] as const)))

  // group open promises by resolvable owner
  const byUser = new Map<string, typeof open>()
  for (const p of open) {
    const uid = p.owner_name ? userByName.get(p.owner_name.trim().toLowerCase()) : undefined
    if (!uid) continue
    if (!byUser.has(uid)) byUser.set(uid, [])
    byUser.get(uid)!.push(p)
  }

  let sent = 0
  for (const [uid, list] of byUser) {
    const lines = list.slice(0, 10).map(p => {
      const it = itemOf.get(p.item_id)
      return `• ${it?.name ?? 'Item'} — ${p.location} (${projOf.get(p.project_id) ?? ''})`
    })
    if (list.length > 10) lines.push(`…and ${list.length - 10} more`)
    const projectId = list[0].project_id
    const title = slot === 'am'
      ? `This week: ${list.length} promise${list.length === 1 ? '' : 's'} to finish`
      : `${list.length} promise${list.length === 1 ? '' : 's'} still open this week`
    const body = (slot === 'am'
      ? 'Your week plan — hold ✓ in My Week as each finishes:\n'
      : 'Quick evening check — anything done today? Tick it off:\n') + lines.join('\n')
    const { error } = await sb.rpc('notify_user', {
      p_user_id: uid, p_type: 'sched_promise_nudge', p_title: title, p_body: body,
      p_url: `/schedule/${projectId}`, p_module_slug: 'schedule',
    })
    if (!error) sent++
  }
  return NextResponse.json({ ok: true, slot, sent, owners: byUser.size, openPromises: open.length })
}
