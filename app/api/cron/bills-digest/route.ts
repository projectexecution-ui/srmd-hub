// Daily per-project "bills with CT" digest email.
//
//   GET  (Vercel cron / dispatcher, Bearer CRON_SECRET) → each Atm Head gets
//        ONE email at 9 AM with a card per THEIR project (bills still in our
//        court, oldest-days first); management CC users get every assigned
//        project. Reads the snapshot the bills-pipeline cron already stores.
//   POST (admin, bills-pipeline edit) → { toHeads?: boolean }: send the real
//        digests now, or (default) a test to the caller.
//
// Images are rendered once per project and embedded as inline (cid) attachments
// via /api/email/send (direct send — the notify_user queue can't carry images).

import { NextResponse } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getMyPermissions, can } from '@/lib/auth'
import { parseBillsDigestConfig, stageAllowed, type BillsDigestConfig } from '@/lib/bills-pipeline/digest-settings'
import { renderProjectPushCard, type DigestBill } from '@/lib/bills-pipeline/project-card'
import { sendCardsToChat } from '@/lib/telegram/dm'
import { personName } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>

interface StuckBill {
  prefix: string; vendor: string; status: string; project: string
  delayDays: number; invoiceNo?: string | null; amount?: number | null; tasklist?: string | null
}

function baseUrl(): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return `https://${prod || 'ct-hub.vercel.app'}`
}
const toDigestBill = (b: StuckBill): DigestBill => ({
  prefix: b.prefix, vendor: b.vendor, status: b.status, project: b.project,
  delayDays: b.delayDays, invoiceNo: b.invoiceNo, amount: b.amount, tasklist: b.tasklist,
})

async function readConfig(supabase: Client): Promise<BillsDigestConfig> {
  const { data } = await supabase.from('app_settings').select('key, value').like('key', 'bills_digest_%')
  return parseBillsDigestConfig((data ?? []) as Array<{ key: string; value: string }>)
}

/** user id → Telegram chat id, for recipients who have connected Telegram. */
async function telegramChats(supabase: Client, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (ids.length === 0) return m
  const { data } = await supabase.from('notification_preferences')
    .select('user_id, telegram, telegram_chat_id').in('user_id', ids)
  for (const r of data ?? []) if (r.telegram && r.telegram_chat_id) m.set(r.user_id as string, r.telegram_chat_id as string)
  return m
}

async function readStuck(supabase: Client): Promise<{ byProject: Map<string, StuckBill[]>; asOf: string; generatedAt: string }> {
  const { data } = await supabase.from('app_settings').select('key, value')
    .in('key', ['bills_pipeline_stuck', 'bills_pipeline_last'])
  const rows = new Map((data ?? []).map(r => [r.key as string, r.value as string]))
  let stuck: StuckBill[] = []
  try { stuck = JSON.parse(rows.get('bills_pipeline_stuck') ?? '[]') } catch { /* ignore */ }
  let asOf = ''
  let generatedAt = new Date().toISOString()
  try {
    const meta = JSON.parse(rows.get('bills_pipeline_last') ?? '{}')
    asOf = meta.asOf ?? ''
    if (meta.generatedAt) generatedAt = meta.generatedAt
  } catch { /* ignore */ }
  const byProject = new Map<string, StuckBill[]>()
  for (const b of stuck) {
    if (!b?.project) continue
    const arr = byProject.get(b.project) ?? []
    arr.push(b)
    byProject.set(b.project, arr)
  }
  return { byProject, asOf, generatedAt }
}

// Snapshot + render context shared across recipients within one run. Cards are
// cached by (project code + the exact stage set) so heads that share a filter
// (e.g. everyone on the Site-Head default) reuse the same rendered image.
interface RenderCtx {
  byProject: Map<string, StuckBill[]>
  asOf: string
  generatedAt: string
  cache: Map<string, string>   // `${code}|${stageKey}` -> base64 ('' = empty, no card)
}
function stageKey(picked: string[] | undefined): string {
  return picked && picked.length ? [...picked].sort().join('~') : '__siteHead__'
}
/** base64 of the card for one project filtered to `picked` stages, or null if empty. */
async function cardFor(ctx: RenderCtx, code: string, picked: string[] | undefined): Promise<string | null> {
  const key = `${code}|${stageKey(picked)}`
  if (ctx.cache.has(key)) { const v = ctx.cache.get(key)!; return v || null }
  const bills = (ctx.byProject.get(code) ?? []).filter(b => stageAllowed(b.status, picked))
  if (bills.length === 0) { ctx.cache.set(key, ''); return null }
  const buf = await renderProjectPushCard(code, bills.map(toDigestBill), ctx.asOf || new Date().toISOString().slice(0, 10), ctx.generatedAt)
  const b64 = buf.toString('base64')
  ctx.cache.set(key, b64)
  return b64
}

/** Assemble each recipient's own cards (already stage-filtered) into one email. */
async function sendDigest(to: string, subject: string, cards: Array<{ code: string; b64: string }>, asOf: string): Promise<string | null> {
  const attachments: Array<{ filename: string; cid: string; contentBase64: string }> = []
  const blocks: string[] = []
  for (const { code, b64 } of cards) {
    const cid = `proj-${code}`
    attachments.push({ filename: `${code}.png`, cid, contentBase64: b64 })
    blocks.push(`<div style="margin:0 0 22px"><img src="cid:${cid}" alt="${code}" style="display:block;width:100%;max-width:680px;border:1px solid #e6ebf1;border-radius:10px"/></div>`)
  }
  if (blocks.length === 0) return 'empty'
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f9;padding:20px"><div style="max-width:720px;margin:0 auto">`
    + `<p style="font-size:15px;color:#1f2d3d;margin:0 0 4px;font-weight:700">Daily bills status — with CT</p>`
    + `<p style="font-size:13px;color:#64748b;margin:0 0 18px">Bills still in our court, per project · oldest first${asOf ? ` · as of ${asOf}` : ''}</p>`
    + blocks.join('')
    + `<p style="font-size:12px;color:#94a3b8;margin:10px 0 0">via CT HUB · Bills Pipeline</p></div></div>`

  const secret = process.env.NOTIFY_INTERNAL_SECRET
  if (!secret) return 'no-internal-secret'
  try {
    const res = await fetch(`${baseUrl()}/api/email/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        to, subject, url: '/bills-pipeline', html, attachments,
        text: 'Daily bills status — open in an HTML mail client to see the project cards.',
      }),
    })
    const j = await res.json().catch(() => ({}))
    return res.ok && j.ok !== false ? null : (j.error || `status ${res.status}`)
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

/** Build one recipient's stage-filtered cards for the given project codes. */
async function cardsForRecipient(ctx: RenderCtx, codes: string[], picked: string[] | undefined): Promise<Array<{ code: string; b64: string }>> {
  const out: Array<{ code: string; b64: string }> = []
  for (const code of codes) {
    const b64 = await cardFor(ctx, code, picked)
    if (b64) out.push({ code, b64 })
  }
  return out
}

async function runAll(supabase: Client, cfg: BillsDigestConfig) {
  const { byProject, asOf, generatedAt } = await readStuck(supabase)
  const ctx: RenderCtx = { byProject, asOf, generatedAt, cache: new Map() }
  const headIds = Object.keys(cfg.assignments)
  const allCodes = [...new Set(Object.values(cfg.assignments).flat())]
  const ids = [...new Set([...headIds, ...cfg.cc])]
  const emailById = new Map<string, string>()
  const nameById = new Map<string, string>()
  if (ids.length) {
    const { data: profs } = await supabase.from('profiles').select('id, full_name, email').in('id', ids)
    for (const p of profs ?? []) {
      emailById.set(p.id as string, (p.email as string) || '')
      nameById.set(p.id as string, (p.full_name as string) || (p.email as string) || 'user')
    }
  }
  // Telegram DM (pic) mirrors the email — for whichever recipients have connected
  // their own Telegram. Same cards, sent straight to their chat.
  const tgById = await telegramChats(supabase, ids)
  const token = process.env.TELEGRAM_BOT_TOKEN

  const sentTo: string[] = []
  const skipped: string[] = []
  const tgSent: string[] = []
  const tgFailed: string[] = []
  for (const [uid, codes] of Object.entries(cfg.assignments)) {
    const email = emailById.get(uid)
    const who = nameById.get(uid) ?? uid
    if (!email) { skipped.push(who); continue }
    const cards = await cardsForRecipient(ctx, codes, cfg.stages[uid])
    const err = await sendDigest(email, 'Daily bills status — your projects', cards, asOf)
    if (err) skipped.push(who); else sentTo.push(who)
    if (token && cards.length && tgById.has(uid)) {
      const r = await sendCardsToChat(token, tgById.get(uid)!, cards, `Daily bills status — your projects${asOf ? ` · as of ${asOf}` : ''}`)
      if ('ok' in r && r.ok) tgSent.push(who)
      else if ('error' in r) tgFailed.push(`${who} (${r.error})`)
    }
  }
  for (const uid of cfg.cc) {
    const email = emailById.get(uid)
    const who = nameById.get(uid) ?? uid
    if (!email) continue
    const cards = await cardsForRecipient(ctx, allCodes, cfg.stages[uid])
    const err = await sendDigest(email, 'Daily bills status — all projects', cards, asOf)
    if (err) skipped.push(`${who} (cc)`); else sentTo.push(`${who} (cc)`)
    if (token && cards.length && tgById.has(uid)) {
      const r = await sendCardsToChat(token, tgById.get(uid)!, cards, `Daily bills status — all projects${asOf ? ` · as of ${asOf}` : ''}`)
      if ('ok' in r && r.ok) tgSent.push(`${who} (cc)`)
      else if ('error' in r) tgFailed.push(`${who} (cc) (${r.error})`)
    }
  }
  return { sentTo, skipped, tgSent, tgFailed }
}

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
  if (Object.keys(cfg.assignments).length === 0) return NextResponse.json({ ok: true, skipped: 'no-assignments' })

  const r = await runAll(supabase, cfg)
  return NextResponse.json({ ok: true, ...r })
}

export async function POST(req: Request) {
  const session = await createClient()
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-pipeline', 'edit')) {
    return NextResponse.json({ ok: false, reason: 'Not allowed' }, { status: 403 })
  }
  const { data: { user } } = await session.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, reason: 'No session' }, { status: 401 })
  const body = await req.json().catch(() => ({} as { toHeads?: boolean; telegramTest?: boolean; to?: 'me' | 'heads' }))
  const supabase = session as unknown as Client
  const cfg = await readConfig(supabase)

  // ── "Test Telegram": ping each assigned head's connected Telegram DM (or the
  //     caller's own, to==='me') so an admin can see who's reachable on Telegram. ──
  if (body.telegramTest) {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!serviceKey) return NextResponse.json({ ok: false, reason: 'No service key' }, { status: 503 })
    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) return NextResponse.json({ ok: false, reason: 'Telegram bot is not configured on the server (TELEGRAM_BOT_TOKEN).' }, { status: 503 })
    const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, { auth: { persistSession: false } }) as unknown as Client

    let targetIds: string[]
    if (body.to === 'me') targetIds = [user.id]
    else {
      targetIds = Object.entries(cfg.assignments).filter(([, codes]) => (codes as string[]).length > 0).map(([id]) => id)
      if (targetIds.length === 0) return NextResponse.json({ ok: false, reason: 'No head → projects assigned yet — assign a head to a project first.' })
    }
    const { data: profs } = await svc.from('profiles').select('id, full_name, name, email').in('id', targetIds)
    const nameById = new Map((profs ?? []).map((p: { id: string; full_name: string | null; name: string | null; email: string | null }) =>
      [p.id, personName(p.full_name, p.name, p.email)]))
    const chatById = await telegramChats(svc, targetIds)
    const connected: string[] = []; const notConnected: string[] = []; const failed: string[] = []
    for (const id of targetIds) {
      const who = nameById.get(id) ?? id
      const chat = chatById.get(id)
      if (!chat) { notConnected.push(who); continue }
      const text = `🔔 CT HUB — Bills Pipeline test\n\nHi ${who}, your Telegram is connected. Your daily "bills still with CT" digest for your projects will arrive here.\n\nThis is only a test — no action needed.`
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

  if (body.toHeads) {
    if (Object.keys(cfg.assignments).length === 0) {
      return NextResponse.json({ ok: false, reason: 'No head → projects assigned yet.' })
    }
    const r = await runAll(supabase, cfg)
    return NextResponse.json({ ok: true, mode: 'heads', ...r })
  }

  // ── "Send me a test": fire BOTH email + Telegram to the caller, always — a
  //     true channel test. Ignores the on/off preference and still sends on a
  //     quiet day (a short "nothing pending" note), so pressing it always
  //     exercises both channels. ──
  // Read email + Telegram chat via a SERVICE client so they're found reliably
  // (same path the working "Test Telegram" button uses).
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const svc: Client = svcKey
    ? (createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, svcKey, { auth: { persistSession: false } }) as unknown as Client)
    : supabase
  const { data: prof } = await svc.from('profiles').select('email').eq('id', user.id).maybeSingle()
  const email = (prof?.email as string) || ''
  if (!email) return NextResponse.json({ ok: false, reason: 'Your profile has no email.' })
  // chat id regardless of the on/off preference — a test should reach it anyway.
  const { data: pref } = await svc.from('notification_preferences').select('telegram_chat_id').eq('user_id', user.id).maybeSingle()
  const chat = (pref?.telegram_chat_id as string | null) || null
  const token = process.env.TELEGRAM_BOT_TOKEN

  const { byProject, asOf, generatedAt } = await readStuck(supabase)
  const ctx: RenderCtx = { byProject, asOf, generatedAt, cache: new Map() }
  const codes = [...new Set(Object.values(cfg.assignments).flat())]
  const useCodes = codes.length ? codes : [...byProject.keys()]
  const cards = await cardsForRecipient(ctx, useCodes, cfg.stages[user.id])

  let emailOk = false; let emailErr: string | null = null; let telegram = false; let telegramErr: string | null = null

  if (cards.length) {
    const err = await sendDigest(email, 'Daily bills status — test', cards, asOf)
    emailOk = err === null; if (!emailOk) emailErr = err
    if (token && chat) {
      const r = await sendCardsToChat(token, chat, cards, `Daily bills status — test${asOf ? ` · as of ${asOf}` : ''}`)
      telegram = 'ok' in r && r.ok
      if (!telegram) telegramErr = ('error' in r ? r.error : 'skipped' in r ? r.skipped : 'send failed')
    }
  } else {
    // Quiet day — nothing stuck. Still send a short note to BOTH channels so the
    // test proves they work.
    const note = 'No bills are stuck with CT right now — this is a channel test. Email and Telegram are both working.'
    const secret = process.env.NOTIFY_INTERNAL_SECRET
    if (!secret) emailErr = 'no-internal-secret'
    else {
      try {
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f9;padding:20px"><div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e6ebf1;border-radius:10px;padding:18px 20px">`
          + `<p style="font-size:15px;font-weight:700;color:#1f2d3d;margin:0 0 6px">Daily bills status — test</p>`
          + `<p style="font-size:13px;color:#334155;margin:0">${note}</p>`
          + `<p style="font-size:11px;color:#94a3b8;margin:14px 0 0">via CT HUB · Bills Pipeline</p></div></div>`
        const res = await fetch(`${baseUrl()}/api/email/send`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
          body: JSON.stringify({ to: email, subject: 'Bills Pipeline — test (nothing pending)', url: '/bills-pipeline', html, text: note }),
        })
        const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string }
        emailOk = res.ok && j.ok !== false; if (!emailOk) emailErr = j.error || `status ${res.status}`
      } catch (e) { emailErr = e instanceof Error ? e.message : String(e) }
    }
    if (token && chat) {
      try {
        const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chat, text: `🔔 CT HUB — Bills Pipeline test\n\n${note}`, disable_web_page_preview: true }),
        })
        const j = await r.json().catch(() => ({})) as { ok?: boolean }
        telegram = !!j.ok
      } catch { /* leave telegram false */ }
    }
  }

  return NextResponse.json({ ok: emailOk || telegram, sent: 1, to: 'you', email: emailOk, emailErr, telegram, telegramErr, connected: !!chat })
}
