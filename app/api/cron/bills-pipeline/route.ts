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
import { parseBill, aggregateCard, clearedThisWeek, toStuckBill, deriveReason } from '@/lib/bills-pipeline/transform'
import { getSelectedProjects } from '@/lib/bills-pipeline/projects'
import { renderCard, renderScorecard } from '@/lib/bills-pipeline/render'
import { BP_CONFIG } from '@/lib/bills-pipeline/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120   // comment enrichment adds per-bill Zoho calls

const CRON_SECRET = process.env.CRON_SECRET

function makeServiceClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceKey, {
    auth: { persistSession: false },
  })
}

// Run fn over items with bounded concurrency; individual failures are swallowed.
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      try { await fn(items[idx]) } catch { /* non-fatal */ }
    }
  })
  await Promise.all(workers)
}

// ── Shared pipeline ──────────────────────────────────────────────────────────

async function runPipeline(supabase: SupabaseClient): Promise<NextResponse> {
  const now      = new Date()
  const weekOf   = monday(now)          // stable weekly filename
  const isoNow   = now.toISOString()
  const asOf     = isoNow.slice(0, 10)  // "as on" date shown on the card

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

  // 2. Fetch all tasks for the selected projects (partial failures tolerated)
  const selectedProjects = await getSelectedProjects(supabase)
  const projectResults = await fetchAllTasks(token, selectedProjects)

  // 3. Parse bills
  const projectIdMap: Record<string, string> = {}
  for (const p of selectedProjects) projectIdMap[p.code] = p.id

  const bills = projectResults.flatMap(({ project, tasks }) => {
    const projectId = projectIdMap[project] ?? ''
    return tasks
      .map(t => parseBill(t, project, projectId, now))
      .filter((b): b is NonNullable<typeof b> => b !== null)
  })

  // Per-project diagnostics — surfaced in the response so a zero-bill run is
  // explainable (which project returned what, and any fetch error) instead of
  // silently showing an empty card.
  const projects = projectResults.map(r => ({
    code:    r.project,
    fetched: r.tasks.length,
    error:   r.error ?? null,
  }))

  // 3b. Delay-comment enrichment — for bills still pending with CT, pull the
  //     latest Zoho comment (only those that have any) and derive a reason
  //     chip. Bounded concurrency + partial-failure tolerant so a comments
  //     scope/rate issue never breaks the run.
  const internalBills = bills.filter(b => b.isInternal)
  const toEnrich = internalBills.filter(b => b.hasComments).slice(0, 400)
  let commentsPulled = 0
  await mapLimit(toEnrich, 8, async b => {
    const cs = await fetchTaskComments(token, b.projectId, b.id)
    if (cs.length) {
      b.latestComment = cs[0].text
      b.commentAuthor = cs[0].author
      b.commentAt     = cs[0].at
      commentsPulled++
    }
  })
  // Reason chip for every pending-with-CT bill (works with or without a comment).
  for (const b of internalBills) {
    b.reason = deriveReason(b.latestComment ?? '', { noWO: b.noWO, hasComments: b.hasComments })
  }

  // 4. Aggregate + enrich (cleared-this-week from raw tasks).
  const cardData = aggregateCard(bills, asOf, isoNow, selectedProjects)

  const allTasks = projectResults.flatMap(r => r.tasks)
  const cleared  = clearedThisWeek(allTasks, now)
  cardData.clearedCount = cleared.count
  cardData.clearedValue = cleared.value

  // Week-over-week deltas anchored to a WEEKLY baseline (not the last run, so
  // running twice a day doesn't reduce deltas to noise). The baseline is
  // snapshotted on the first run of each ISO week and compared against all week.
  const baseline = await readBaseline(supabase)
  if (baseline) {
    const d = (cur: number, key: string) =>
      typeof baseline[key] === 'number' ? cur - (baseline[key] as number) : null
    cardData.deltas = {
      totalValue:   d(cardData.totalValue,   'totalValue'),
      ctValue:      d(cardData.ctValue,      'ctValue'),
      trustValue:   d(cardData.trustValue,   'trustValue'),
      stalledValue: d(cardData.stalledValue, 'stalledValue'),
    }
  }
  // Roll the baseline forward once per week (first run of a new week captures
  // this week's opening values for the rest of the week to compare against).
  if (!baseline || baseline.weekOf !== weekOf) {
    await supabase.from('app_settings').upsert({
      key: 'bills_pipeline_wbaseline',
      value: JSON.stringify({
        weekOf,
        totalValue:   cardData.totalValue,
        ctValue:      cardData.ctValue,
        trustValue:   cardData.trustValue,
        stalledValue: cardData.stalledValue,
      }),
    }, { onConflict: 'key' })
  }

  // 5. Render report PNGs — abort on failure, do NOT touch storage
  let png: Buffer, scorecardPng: Buffer
  try {
    png          = await renderCard(cardData)
    scorecardPng = await renderScorecard(cardData)
  } catch (e) {
    return NextResponse.json(
      { ok: false, reason: `Render failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }

  // 6. Upload both reports + prune
  const filename      = `bills-pipeline-${weekOf}.png`
  const scorecardName = `bills-pipeline-scorecard-${weekOf}.png`
  const up1 = await uploadAndPrune(supabase, filename, png)
  if (up1.uploadError) {
    return NextResponse.json({ ok: false, reason: `Upload failed: ${up1.uploadError}` }, { status: 500 })
  }
  const up2 = await uploadAndPrune(supabase, scorecardName, scorecardPng)
  if (up2.uploadError) {
    return NextResponse.json({ ok: false, reason: `Scorecard upload failed: ${up2.uploadError}` }, { status: 500 })
  }
  const pruned = up1.pruned + up2.pruned

  // 7. Record metadata — includes the value snapshot so next week can show
  //    week-over-week deltas, plus each report's stored filename.
  const meta = JSON.stringify({
    generatedAt:   isoNow,
    asOf,
    file:          filename,
    scorecardFile: scorecardName,
    billCount:     cardData.totalCount,
    totalValue:    cardData.totalValue,
    ctValue:       cardData.ctValue,
    trustValue:    cardData.trustValue,
    stalledValue:  cardData.stalledValue,
    clearedValue:  cardData.clearedValue,
    ctCount:       cardData.ctCount,
    stalled:       cardData.stalledCount,
    noWoCount:     cardData.noWoCount,
  })
  const metaError = await recordMeta(supabase, meta)
  if (metaError) {
    return NextResponse.json(
      { ok: false, reason: `Card stored but couldn't record metadata: ${metaError}` },
      { status: 500 },
    )
  }

  // 8. Persist the bills that still need CT follow-up for the interactive
  //    "Stuck Bills" tab. Bills already submitted to Trust are done from our
  //    end — excluded. Sorted by delay (oldest bill first).
  const stuck = bills
    .filter(b => b.isInternal)
    .map(b => toStuckBill(b, cardData.projectMap))
    .sort((a, b) => b.delayDays - a.delayDays)
    .slice(0, 500)
  const { error: stuckErr } = await supabase
    .from('app_settings')
    .upsert({ key: 'bills_pipeline_stuck', value: JSON.stringify(stuck) }, { onConflict: 'key' })
  if (stuckErr) console.warn('[bills-pipeline] stuck-bills persist failed:', stuckErr.message)

  // TODO: send PNG to WhatsApp via WABA API
  // TODO: email PNG via nodemailer

  return NextResponse.json({
    ok:        true,
    file:      filename,
    bytes:     png.byteLength,
    bills:     cardData.totalCount,
    pendingCT: cardData.ctCount,
    trust:     cardData.trustCount,
    stalled:   cardData.stalledCount,
    noWO:      cardData.noWoCount,
    commentsPulled,
    projects,
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

// The weekly baseline snapshot — used to compute week-over-week deltas.
async function readBaseline(supabase: SupabaseClient): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'bills_pipeline_wbaseline')
    .maybeSingle()
  if (error || !data?.value) return null
  try {
    return JSON.parse(data.value as string) as Record<string, unknown>
  } catch {
    return null
  }
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
