// Bills Pipeline cron + manual refresh endpoint.
//
//   GET ?cron=1  — Vercel Cron (Monday 04:00 UTC). Fail-closed auth.
//   POST         — Manual refresh from the dashboard (bills-pipeline edit perm).
//
// Both paths use the service-role Supabase client so Zoho token reads and
// storage writes are not blocked by RLS.

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { getMyPermissions, can } from '@/lib/auth'
import { getZohoToken, fetchAllTasks, fetchTaskComments } from '@/lib/bills-pipeline/zoho'
import { parseBill, aggregateCard, deriveReason } from '@/lib/bills-pipeline/transform'
import { renderCard } from '@/lib/bills-pipeline/render'
import { BP_CONFIG } from '@/lib/bills-pipeline/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_SECRET = process.env.CRON_SECRET

function makeServiceClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  })
}

// ── Shared pipeline ──────────────────────────────────────────────────────────

async function runPipeline(supabase: SupabaseClient): Promise<NextResponse> {
  const now     = new Date()
  const weekOf  = monday(now)
  const isoNow  = now.toISOString()

  // 1. Zoho OAuth token
  let token: string
  try {
    token = await getZohoToken(supabase)
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : 'Token fetch failed' },
      { status: 503 },
    )
  }

  // 2. Fetch all tasks (partial failures tolerated)
  const projectResults = await fetchAllTasks(token)

  // 3. Parse bills
  const projectIdMap: Record<string, string> = {}
  for (const [code, id] of Object.entries(BP_CONFIG.PROJECTS)) {
    projectIdMap[code] = id
  }

  const bills = projectResults.flatMap(({ project, tasks }) => {
    const projectId = projectIdMap[project] ?? ''
    return tasks
      .map(t => parseBill(t, project, projectId, now))
      .filter((b): b is NonNullable<typeof b> => b !== null)
  })

  // 4. Enrich stalled push-list candidates with comment-derived reason
  const pushCandidates = bills.filter(
    b =>
      b.stalled &&
      b.ageDays >= BP_CONFIG.PUSH_MIN_AGE_DAYS &&
      b.claimed >= BP_CONFIG.PUSH_MIN_CLAIMED,
  )
  await Promise.allSettled(
    pushCandidates.map(async b => {
      const comments = await fetchTaskComments(token, b.projectId, b.id)
      b.pushReason   = deriveReason(comments)
    }),
  )

  // 5. Aggregate
  const cardData = aggregateCard(bills, weekOf, isoNow)

  // 6. Render PNG — abort on failure, do NOT touch storage
  let png: Buffer
  try {
    png = await renderCard(cardData)
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: `Render failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }

  // 7. Upload + prune
  const filename   = `bills-pipeline-${weekOf}.png`
  const { uploadError, pruned } = await uploadAndPrune(supabase, filename, png)
  if (uploadError) {
    return NextResponse.json({ ok: false, reason: `Upload failed: ${uploadError}` }, { status: 500 })
  }

  // 8. Record metadata
  const meta = JSON.stringify({
    generatedAt: isoNow,
    weekOf,
    file:        filename,
    billCount:   cardData.totalBills,
    stalled:     cardData.stalledCount,
    noWOcount:   cardData.noWOcount,
  })
  const metaError = await recordMeta(supabase, meta)
  if (metaError) {
    return NextResponse.json(
      { ok: false, reason: `Card stored but couldn't record metadata: ${metaError}` },
      { status: 500 },
    )
  }

  // TODO: send PNG to WhatsApp via WABA API
  // TODO: email PNG via nodemailer

  return NextResponse.json({
    ok:       true,
    file:     filename,
    bytes:    png.byteLength,
    bills:    cardData.totalBills,
    stalled:  cardData.stalledCount,
    pruned,
  })
}

// ── Storage helpers ──────────────────────────────────────────────────────────

async function uploadAndPrune(
  supabase: SupabaseClient,
  path: string,
  buffer: Buffer,
): Promise<{ uploadError: string | null; pruned: number }> {
  const { error: upErr } = await supabase.storage
    .from(BP_CONFIG.BUCKET)
    .upload(path, buffer, { contentType: 'image/png', upsert: true })

  if (upErr) return { uploadError: upErr.message, pruned: 0 }

  const { data: listed, error: listErr } = await supabase.storage
    .from(BP_CONFIG.BUCKET)
    .list('', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })

  if (listErr) {
    console.warn('[bills-pipeline] prune skipped — list failed:', listErr.message)
    return { uploadError: null, pruned: 0 }
  }

  const stale = (listed ?? [])
    .map(f => f.name)
    .filter(n => n.endsWith('.png'))
    .slice(BP_CONFIG.KEEP_FILES)

  if (stale.length > 0) {
    const { error: rmErr } = await supabase.storage.from(BP_CONFIG.BUCKET).remove(stale)
    if (rmErr) console.warn('[bills-pipeline] prune failed:', rmErr.message)
  }

  return { uploadError: null, pruned: stale.length }
}

async function recordMeta(supabase: SupabaseClient, value: string): Promise<string | null> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: BP_CONFIG.APP_SETTINGS_KEY, value }, { onConflict: 'key' })
  return error ? error.message : null
}

// Returns the ISO date of the most-recent Monday (or today if Monday)
function monday(d: Date): string {
  const day   = d.getUTCDay()   // 0=Sun, 1=Mon
  const delta = day === 0 ? 6 : day - 1
  const m     = new Date(d)
  m.setUTCDate(d.getUTCDate() - delta)
  return m.toISOString().slice(0, 10)
}

// ── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('cron') !== '1') {
    return NextResponse.json({ ok: false, reason: 'Use POST for manual refresh' }, { status: 405 })
  }

  const auth = req.headers.get('authorization') || ''
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }

  let supabase: SupabaseClient
  try {
    supabase = makeServiceClient()
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : 'Service client init failed' },
      { status: 503 },
    )
  }

  return runPipeline(supabase)
}

export async function POST() {
  const perms = await getMyPermissions()
  if (!can(perms, 'bills-pipeline', 'edit')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — bills-pipeline edit required' }, { status: 403 })
  }

  let supabase: SupabaseClient
  try {
    supabase = makeServiceClient()
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: e instanceof Error ? e.message : 'Service client init failed' },
      { status: 503 },
    )
  }

  return runPipeline(supabase)
}
