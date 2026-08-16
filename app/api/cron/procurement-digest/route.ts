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
import { buildHeadDigest, digestSubject, digestText, digestFullText, digestCardSpec } from '@/lib/procurement/digest'
import type { StoredSnapshot } from '@/lib/procurement/types'
import { personName } from '@/lib/utils'
import { sendCardsToChat } from '@/lib/telegram/dm'
import { renderCardSpec } from '@/lib/telegram/report-card'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IST = 5.5 * 3600 * 1000
const HOUR = 3600 * 1000

function baseUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return `https://${prod || 'ct-hub.vercel.app'}`
}
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

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

async function notify(supabase: Client, userId: string, digest: ReturnType<typeof buildHeadDigest>, recipientName: string | null): Promise<string | null> {
  if (!digest) return 'empty'
  const { error } = await supabase.rpc('notify_user', {
    p_user_id: userId,
    p_type: 'procurement_digest',
    p_title: digestSubject(digest),
    p_body: digestText(digest),
    p_url: '/procurement-tracker',
    p_module_slug: 'procurement-tracker',
    // digest fields drive the HTML email (unchanged); report_text + card_spec
    // are extra keys the Telegram sender uses for the full-detail image card.
    // The Atm Head's name goes on the card so the recipient knows it's theirs.
    p_data: { ...digest, report_text: digestFullText(digest), card_spec: digestCardSpec(digest, recipientName) },
  })
  return error ? error.message : null
}

/** Display name per user id (personName precedence: editable name → full_name). */
async function namesFor(supabase: Client, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from('profiles').select('id, full_name, name, email').in('id', ids)
  return new Map((data ?? []).map((p: { id: string; full_name: string | null; name: string | null; email: string | null }) =>
    [p.id, personName(p.full_name, p.name, p.email)]))
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
  const nameById = await namesFor(supabase, heads.map(([uid]) => uid))
  let sent = 0
  const detail: Array<{ uid: string; sent?: boolean; skipped?: string; error?: string }> = []
  for (const [uid, projects] of heads) {
    const digest = buildHeadDigest(current, baseline, cfg, nowMs, projects)
    if (!digest) { detail.push({ uid, skipped: 'empty' }); continue }
    const err = await notify(supabase, uid, digest, nameById.get(uid) ?? null)
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

  const body = await req.json().catch(() => ({} as { headId?: string; toHeads?: boolean; telegramTest?: boolean; to?: 'me' | 'heads' }))
  const supabase = session as unknown as Client
  const cfg = await readConfig(supabase)

  // ── "Test Telegram": ping each assigned head's connected Telegram DM (or the
  //     caller's own, to==='me') with a short connectivity check — so an admin can
  //     see who is actually reachable on Telegram before relying on it. ──
  if (body.telegramTest) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) return NextResponse.json({ ok: false, reason: 'Telegram bot is not configured on the server (TELEGRAM_BOT_TOKEN).' }, { status: 503 })
    const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } }) as unknown as Client

    let targetIds: string[]
    if (body.to === 'me') targetIds = [uid]
    else {
      targetIds = Object.entries(cfg.assignments).filter(([, projs]) => projs.length > 0).map(([id]) => id)
      if (targetIds.length === 0) return NextResponse.json({ ok: false, reason: 'No head → projects mapping set yet — assign a head to a project first.' })
    }
    const nameById = await namesFor(svc, targetIds)
    const { data: prefs } = await svc.from('notification_preferences')
      .select('user_id, telegram, telegram_chat_id').in('user_id', targetIds)
    const chatById = new Map<string, string>()
    for (const r of (prefs ?? []) as Array<{ user_id: string; telegram: boolean | null; telegram_chat_id: string | null }>) {
      if (r.telegram && r.telegram_chat_id) chatById.set(r.user_id, r.telegram_chat_id)
    }
    const connected: string[] = []; const notConnected: string[] = []; const failed: string[] = []
    for (const id of targetIds) {
      const who = nameById.get(id) ?? id
      const chat = chatById.get(id)
      if (!chat) { notConnected.push(who); continue }
      const text = `🔔 CT HUB — Indent → PO test\n\nHi ${who}, your Telegram is connected. Your weekday follow-up reminders (POs to raise · deliveries to chase) for your projects will arrive here.\n\nThis is only a test — no action needed.`
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
        })
        const j = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string }
        if (j.ok) connected.push(who); else failed.push(`${who} (${j.description || 'send failed'})`)
      } catch (e) {
        failed.push(`${who} (${e instanceof Error ? e.message : 'network error'})`)
      }
    }
    return NextResponse.json({ ok: true, mode: 'telegramTest', connected, notConnected, failed })
  }

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
    const nameById = await namesFor(supabase, heads.map(([uid]) => uid))
    const sentTo: string[] = []
    const skipped: string[] = []
    for (const [uid, projects] of heads) {
      const digest = buildHeadDigest(current, baseline, cfg, nowMs, projects)
      const who = nameById.get(uid) ?? uid
      if (!digest) { skipped.push(who); continue }
      const err = await notify(supabase, uid, digest, nameById.get(uid) ?? null)
      if (err) skipped.push(who); else sentTo.push(who)
    }
    return NextResponse.json({ ok: true, mode: 'heads', sent: sentTo.length, sentTo, skipped })
  }

  // ── Default "Send me a test": fire BOTH email + Telegram to the caller,
  //     directly and unconditionally — a true channel test. It ignores the
  //     personal on/off preference and still sends on a quiet day, so pressing
  //     it always exercises both channels. ──
  const projects = body.headId && cfg.assignments[body.headId]
    ? cfg.assignments[body.headId]
    : [...new Set(Object.values(cfg.assignments).flat())]
  if (projects.length === 0) {
    return NextResponse.json({ ok: false, reason: 'No projects assigned to any head yet — add a head → projects mapping first.' })
  }

  const { current, baseline } = await loadState(supabase)
  if (!current) return NextResponse.json({ ok: false, reason: 'No tracker data uploaded yet.' })
  const digest = buildHeadDigest(current, baseline, cfg, Date.now(), projects)

  // Read the caller's email + Telegram chat via a SERVICE client so it's found
  // reliably (same path the working "Test Telegram" button uses).
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const svc: Client = svcKey
    ? (createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey, { auth: { persistSession: false } }) as unknown as Client)
    : supabase
  const { data: prof } = await svc.from('profiles').select('email').eq('id', uid).maybeSingle()
  const email = (prof?.email as string) || ''
  // chat id regardless of the on/off preference — a test should reach it anyway.
  const { data: pref } = await svc.from('notification_preferences').select('telegram_chat_id').eq('user_id', uid).maybeSingle()
  const chat = (pref?.telegram_chat_id as string | null) || null

  const bodyText = digest ? digestFullText(digest)
    : 'No pending items for your projects right now — this is a channel test. Email and Telegram are both working.'
  const subject = digest ? `${digestSubject(digest)} — test` : 'Indent → PO — test (nothing pending)'

  // Email (direct, via the internal send route so it never depends on prefs).
  let emailOk = false; let emailErr: string | null = null
  if (!email) { emailErr = 'no-email' }
  else {
    const secret = process.env.NOTIFY_INTERNAL_SECRET
    if (!secret) emailErr = 'no-internal-secret'
    else {
      try {
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f9;padding:20px"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e6ebf1;border-radius:10px;padding:18px 20px">`
          + `<p style="font-size:15px;font-weight:700;color:#1f2d3d;margin:0 0 4px">Indent → PO — test</p>`
          + `<p style="font-size:12px;color:#64748b;margin:0 0 14px">Your projects: ${escHtml(projects.join(', '))}</p>`
          + `<pre style="font-family:inherit;font-size:13px;color:#334155;white-space:pre-wrap;margin:0">${escHtml(bodyText)}</pre>`
          + `<p style="font-size:11px;color:#94a3b8;margin:14px 0 0">via CT HUB · Indent → PO</p></div></div>`
        const res = await fetch(`${baseUrl()}/api/email/send`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
          body: JSON.stringify({ to: email, subject, url: '/procurement-tracker', html, text: bodyText }),
        })
        const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
        emailOk = res.ok && j.ok !== false; if (!emailOk) emailErr = j.error || `status ${res.status}`
      } catch (e) { emailErr = e instanceof Error ? e.message : String(e) }
    }
  }

  // Telegram (direct, if connected — ignoring the on/off preference). Sends the
  // SAME rich report card as the daily digest when there's content, else a note.
  let telegramOk = false
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (chat && token) {
    try {
      if (digest) {
        const callerName = (await namesFor(svc, [uid])).get(uid) ?? null
        const png = await renderCardSpec(digestCardSpec(digest, callerName))
        const r = await sendCardsToChat(token, chat, [{ code: 'indent-po', b64: png.toString('base64') }], subject)
        telegramOk = 'ok' in r && r.ok
      } else {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chat, text: `🔔 CT HUB — Indent → PO test\n\n${bodyText}`, disable_web_page_preview: true }),
        })
        const j = await r.json().catch(() => ({})) as { ok?: boolean }
        telegramOk = !!j.ok
      }
    } catch { /* leave telegramOk false */ }
  }

  return NextResponse.json({ ok: emailOk || telegramOk, sent: 1, to: 'you', email: emailOk, emailErr, telegram: telegramOk, connected: !!chat })
}
