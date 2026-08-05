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
import { parseBillsDigestConfig, type BillsDigestConfig } from '@/lib/bills-pipeline/digest-settings'
import { renderProjectPushCard, type DigestBill } from '@/lib/bills-pipeline/project-card'

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

/** Render each needed project card ONCE → base64, reused across recipients. */
async function renderCards(codes: string[], byProject: Map<string, StuckBill[]>, asOf: string, generatedAt: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const code of codes) {
    const bills = byProject.get(code) ?? []
    if (bills.length === 0) continue  // nothing stuck → no card
    const buf = await renderProjectPushCard(code, bills.map(toDigestBill), asOf || new Date().toISOString().slice(0, 10), generatedAt)
    out.set(code, buf.toString('base64'))
  }
  return out
}

async function sendDigest(to: string, subject: string, codes: string[], cards: Map<string, string>, asOf: string): Promise<string | null> {
  const attachments: Array<{ filename: string; cid: string; contentBase64: string }> = []
  const blocks: string[] = []
  for (const code of codes) {
    const b64 = cards.get(code)
    if (!b64) continue
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

async function runAll(supabase: Client, cfg: BillsDigestConfig) {
  const { byProject, asOf, generatedAt } = await readStuck(supabase)
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
  const cards = await renderCards(allCodes, byProject, asOf, generatedAt)

  const sentTo: string[] = []
  const skipped: string[] = []
  for (const [uid, codes] of Object.entries(cfg.assignments)) {
    const email = emailById.get(uid)
    const who = nameById.get(uid) ?? uid
    if (!email) { skipped.push(who); continue }
    const err = await sendDigest(email, 'Daily bills status — your projects', codes, cards, asOf)
    if (err) skipped.push(who); else sentTo.push(who)
  }
  for (const uid of cfg.cc) {
    const email = emailById.get(uid)
    const who = nameById.get(uid) ?? uid
    if (!email) continue
    const err = await sendDigest(email, 'Daily bills status — all projects', allCodes, cards, asOf)
    if (err) skipped.push(`${who} (cc)`); else sentTo.push(`${who} (cc)`)
  }
  return { sentTo, skipped }
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
  const body = await req.json().catch(() => ({} as { toHeads?: boolean }))
  const supabase = session as unknown as Client
  const cfg = await readConfig(supabase)

  if (body.toHeads) {
    if (Object.keys(cfg.assignments).length === 0) {
      return NextResponse.json({ ok: false, reason: 'No head → projects assigned yet.' })
    }
    const r = await runAll(supabase, cfg)
    return NextResponse.json({ ok: true, mode: 'heads', ...r })
  }

  // Test to self: every assigned project (or all projects that have stuck bills).
  const { data: prof } = await supabase.from('profiles').select('email').eq('id', user.id).maybeSingle()
  const email = (prof?.email as string) || ''
  if (!email) return NextResponse.json({ ok: false, reason: 'Your profile has no email.' })
  const { byProject, asOf, generatedAt } = await readStuck(supabase)
  const codes = [...new Set(Object.values(cfg.assignments).flat())]
  const useCodes = codes.length ? codes : [...byProject.keys()]
  const cards = await renderCards(useCodes, byProject, asOf, generatedAt)
  const err = await sendDigest(email, 'Daily bills status — test', useCodes, cards, asOf)
  if (err === 'empty') return NextResponse.json({ ok: true, sent: 0, reason: 'No bills stuck with CT right now — nothing to send.' })
  if (err) return NextResponse.json({ ok: false, error: err }, { status: 500 })
  return NextResponse.json({ ok: true, sent: 1, to: 'you' })
}
