// Weekday reminder digests for the Indent → PO Tracker.
//
//   GET  (Vercel cron, Bearer CRON_SECRET) → send each Atm Head their scoped
//        reminder (raise-PO 2+ days · chase-GRN 1 week+), cumulative, once/day.
//   POST (admin, procurement-tracker edit) → "send me a test": preview one
//        head's (or the combined) digest to the caller's own inbox.
//
// Delivery rides the native Gmail queue via notify_user() — respects each
// recipient's own notification preferences + the /admin/notifications policy.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'
import { parseProcurementNotifyConfig, type ProcurementNotifyConfig } from '@/lib/procurement/notify-settings'
import { buildHeadDigest, digestSubject, digestText } from '@/lib/procurement/digest'
import type { StoredSnapshot } from '@/lib/procurement/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IST = 5.5 * 3600 * 1000
const HOUR = 3600 * 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

async function readConfig(supabase: Client): Promise<ProcurementNotifyConfig> {
  const { data } = await supabase.from('app_settings').select('key, value').like('key', 'procurement_notify_%')
  return parseProcurementNotifyConfig((data ?? []) as Array<{ key: string; value: string }>)
}

async function loadState(supabase: Client): Promise<{ current: StoredSnapshot | null; baseline: StoredSnapshot | null }> {
  const { data: row } = await supabase
    .from('procurement_tracker_state').select('state').eq('id', 'global').maybeSingle()
  const current = (row?.state as StoredSnapshot | undefined) ?? null
  let baseline: StoredSnapshot | null = null
  if (current) {
    const cutoff = new Date(Date.now() - 20 * HOUR).toISOString()
    const { data: hist } = await supabase
      .from('procurement_tracker_state_history')
      .select('state, snapshot_at').lt('snapshot_at', cutoff)
      .order('snapshot_at', { ascending: false }).limit(1)
    baseline = (hist?.[0]?.state as StoredSnapshot | undefined) ?? null
  }
  return { current, baseline }
}

async function notify(supabase: Client, userId: string, digest: ReturnType<typeof buildHeadDigest>): Promise<string | null> {
  if (!digest) return 'empty'
  const { error } = await supabase.rpc('notify_user', {
    p_user_id: userId,
    p_type: 'procurement_digest',
    p_title: digestSubject(digest),
    p_body: digestText(digest),
    p_url: '/procurement-tracker',
    p_module_slug: 'procurement-tracker',
    p_data: digest,
  })
  return error ? error.message : null
}

// ── GET: the daily cron ────────────────────────────────────────────────────
export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })
  const supabase = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } })

  const cfg = await readConfig(supabase)
  if (!cfg.enabled) return NextResponse.json({ ok: true, skipped: 'disabled' })

  const nowMs = Date.now()
  const ist = new Date(nowMs + IST)
  const dow = ist.getUTCDay()               // 0 = Sunday
  const dateKey = ist.toISOString().slice(0, 10)
  if (cfg.frequency === 'weekdays' && dow === 0) return NextResponse.json({ ok: true, skipped: 'sunday' })
  if (cfg.frequency === 'weekly' && dow !== cfg.weeklyDay) return NextResponse.json({ ok: true, skipped: 'not-weekly-day' })
  if (cfg.lastSentAt) {
    const lastKey = new Date(Date.parse(cfg.lastSentAt) + IST).toISOString().slice(0, 10)
    if (lastKey === dateKey) return NextResponse.json({ ok: true, skipped: 'already-sent-today' })
  }

  const { current, baseline } = await loadState(supabase)
  if (!current) return NextResponse.json({ ok: true, skipped: 'no-tracker-data' })
  if (cfg.frequency === 'on_upload') {
    const savedMs = Date.parse(current.savedAt)
    if (!Number.isFinite(savedMs) || nowMs - savedMs > 24 * HOUR) {
      return NextResponse.json({ ok: true, skipped: 'no-fresh-upload' })
    }
  }

  const heads = Object.entries(cfg.assignments).filter(([, projs]) => projs.length > 0)
  let sent = 0
  const detail: Array<{ uid: string; sent?: boolean; skipped?: string; error?: string }> = []
  for (const [uid, projects] of heads) {
    const digest = buildHeadDigest(current, baseline, cfg, nowMs, projects)
    if (!digest) { detail.push({ uid, skipped: 'empty' }); continue }
    const err = await notify(supabase, uid, digest)
    if (err) detail.push({ uid, error: err })
    else { sent++; detail.push({ uid, sent: true }) }
  }
  await supabase.from('app_settings').upsert(
    { key: 'procurement_notify_last_sent_at', value: new Date().toISOString() }, { onConflict: 'key' })

  return NextResponse.json({ ok: true, heads: heads.length, sent, detail })
}

// ── POST: "send me a test" ─────────────────────────────────────────────────
export async function POST(req: Request) {
  const session = await createClient()
  const perms = await getMyPermissions()
  if (!can(perms, 'procurement-tracker', 'edit')) {
    return NextResponse.json({ ok: false, reason: 'Not allowed' }, { status: 403 })
  }
  const { data: userData } = await session.auth.getUser()
  const uid = userData?.user?.id
  if (!uid) return NextResponse.json({ ok: false, reason: 'No session' }, { status: 401 })

  const body = await req.json().catch(() => ({} as { headId?: string; toHeads?: boolean }))
  const supabase = session as unknown as Client
  const cfg = await readConfig(supabase)

  // ── "Send to the heads now": push each assigned head their real scoped
  //     digest on demand (same as the daily cron, minus the day/dedup gates).
  if (body.toHeads) {
    const { current, baseline } = await loadState(supabase)
    if (!current) return NextResponse.json({ ok: false, reason: 'No tracker data uploaded yet.' })
    const heads = Object.entries(cfg.assignments).filter(([, projs]) => projs.length > 0)
    if (heads.length === 0) {
      return NextResponse.json({ ok: false, reason: 'No head → projects mapping set yet — assign at least one head to a project first.' })
    }
    const nowMs = Date.now()
    const ids = heads.map(([uid]) => uid)
    const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    const nameById = new Map((profs ?? []).map(p => [p.id as string, (p.full_name as string) || (p.email as string)]))
    const sentTo: string[] = []
    const skipped: string[] = []
    for (const [uid, projects] of heads) {
      const digest = buildHeadDigest(current, baseline, cfg, nowMs, projects)
      const who = nameById.get(uid) ?? uid
      if (!digest) { skipped.push(who); continue }
      const err = await notify(supabase, uid, digest)
      if (err) skipped.push(who); else sentTo.push(who)
    }
    return NextResponse.json({ ok: true, mode: 'heads', sent: sentTo.length, sentTo, skipped })
  }

  // Scope: a specific head's projects, else every assigned project combined.
  const projects = body.headId && cfg.assignments[body.headId]
    ? cfg.assignments[body.headId]
    : [...new Set(Object.values(cfg.assignments).flat())]
  if (projects.length === 0) {
    return NextResponse.json({ ok: false, reason: 'No projects assigned to any head yet — add a head → projects mapping first.' })
  }

  const { current, baseline } = await loadState(supabase)
  if (!current) return NextResponse.json({ ok: false, reason: 'No tracker data uploaded yet.' })

  const digest = buildHeadDigest(current, baseline, cfg, Date.now(), projects)
  if (!digest) return NextResponse.json({ ok: true, sent: 0, reason: 'Nothing to report for those projects right now.' })

  const err = await notify(supabase, uid, digest)
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 500 })
  return NextResponse.json({ ok: true, sent: 1, to: 'you', projects })
}
