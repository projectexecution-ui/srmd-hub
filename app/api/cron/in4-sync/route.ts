// IN4 live sync — one route, five feeds.
//
//   GET  ?cron=1[&feed=…]  — the cron dispatcher, twice a day, one call per feed
//                            (Bearer CRON_SECRET). No feed = the budget report.
//   POST { feed?, mode? }  — "Run now" from /admin/in4, with an optional
//                            mode: 'shadow' | 'live' to force one run.
//
// The route only reaches IN4 when the five IN4_DB_* variables are set; without
// them it answers 503 with the reason instead of failing quietly.

import { NextRequest, NextResponse } from 'next/server'
import { getMyPermissions, can, getMyUser } from '@/lib/auth'
import { in4Config } from '@/lib/in4/db'
import { runIn4Sync } from '@/lib/in4/sync'
import { runFeed, FEEDS, type Feed } from '@/lib/in4/feeds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A handful of SELECTs to Virginia plus a few thousand upserts — comfortably
// under a minute per feed, but not the default 10 s.
export const maxDuration = 120

const CRON_SECRET = process.env.CRON_SECRET

function parseFeed(v: string | null | undefined): Feed | null {
  if (!v) return 'budget'
  return (FEEDS as string[]).includes(v) ? (v as Feed) : null
}

async function run(feed: Feed, opts: { trigger: 'cron' | 'manual'; actorId: string | null; forceMode?: 'shadow' | 'live' }) {
  if (feed === 'budget') return runIn4Sync(opts)
  return runFeed(feed, opts)
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('cron') !== '1') {
    return NextResponse.json({ ok: false, reason: 'Cron only' }, { status: 405 })
  }
  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  if (!in4Config()) {
    return NextResponse.json({ ok: false, reason: 'IN4 is not configured on this deployment (IN4_DB_* env vars missing)' }, { status: 503 })
  }
  const feed = parseFeed(req.nextUrl.searchParams.get('feed'))
  if (!feed) return NextResponse.json({ ok: false, reason: 'Unknown feed' }, { status: 400 })
  const result = await run(feed, { trigger: 'cron', actorId: null })
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}

export async function POST(req: NextRequest) {
  const perms = await getMyPermissions()
  if (!can(perms, 'admin-settings', 'view') && !can(perms, 'budget-vs-actual', 'admin') && !can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden' }, { status: 403 })
  }
  if (!in4Config()) {
    return NextResponse.json({ ok: false, reason: 'IN4 is not configured on this deployment (IN4_DB_* env vars missing)' }, { status: 503 })
  }
  let body: { feed?: string; mode?: 'shadow' | 'live' } = {}
  try { body = await req.json() } catch { /* no body is fine */ }
  const feed = parseFeed(body.feed)
  if (!feed) return NextResponse.json({ ok: false, reason: 'Unknown feed' }, { status: 400 })
  const user = await getMyUser()
  const result = await run(feed, { trigger: 'manual', actorId: user?.id ?? null, forceMode: body.mode })
  return NextResponse.json(result, { status: result.ok ? 200 : 500 })
}
