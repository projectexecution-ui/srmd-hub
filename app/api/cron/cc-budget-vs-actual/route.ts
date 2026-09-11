// Monday "Budget vs Actual" report to management.
//
// 11 Sep 2026 (Aksha): the report is built on HER list, not IN4's — see
// lib/weekly-report/config.ts — with these rules:
//   • once per Monday, guarded in the config (lastSentWeek), not the shared
//     cron ledger that stopped stamping in the afternoon slot and caused twins;
//   • "this week" = change since the PREVIOUS MONDAY'S SEND, saved on purpose
//     in budget_v2_weekly_snapshot at every real send;
//   • recipients come from the config (or management roles until chosen),
//     each through notify_user() so per-person and global channel switches hold;
//   • the PDF set to the Telegram reports group is its own switch.
//
// GET  — the cron dispatcher (Bearer CRON_SECRET). Monday only; skips if this
//        week already went out.
// POST — an admin, signed in. { onlyMe } DMs a preview to the caller;
//        { group } posts the PDFs to the reports group only; { sendNow } does
//        the real Monday send today and marks the week as sent.

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import { shownName, snapshotOf } from '@/lib/budget-v2'
import { buildBudgetV2Report } from '@/lib/budget-v2-report'
import { buildWeeklyOnePagerPdf, buildWeeklyDetailPdf, projectPdfFilename, groupPdfFilename, displayGroupName, UNGROUPED } from '@/lib/budget-v2-pdf'
import { sendPdfToGroup } from '@/lib/telegram/group'
import { loadWeeklyReport, type WeeklyLoaded } from '@/lib/weekly-report/load'
import { resolveRecipients, serializeWeeklyConfig, mondayOf, isMondayIST, WEEKLY_CONFIG_KEY, WEEKLY_EVENT } from '@/lib/weekly-report/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function serviceClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}
type Svc = ReturnType<typeof serviceClient>

// The PDF set: one-pager, by category, by sub-category, then one forwardable
// file per main project (a heading with 2+ lines travels as one file, a page
// per line; a single-line heading gets its own file).
async function sendPdfsToGroup(svc: Svc, loaded: WeeklyLoaded): Promise<{ sent: number; total: number; noGroup: boolean; errors: string[] }> {
  const { result, freshness, delta, prevSnapshotWeek, prev } = loaded
  const base = { result, freshness, delta, prevSnapshotWeek }
  const tag = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
  const files = [
    { name: `Budget-vs-Actual_One-pager_${tag}.pdf`, caption: 'Weekly Budget vs Actual — one-pager', pdf: buildWeeklyOnePagerPdf(base) },
    { name: `Budget-vs-Actual_By-Category_${tag}.pdf`, caption: 'Weekly Budget vs Actual — by category', pdf: buildWeeklyDetailPdf({ ...base, prev }, 'category') },
    { name: `Budget-vs-Actual_By-Sub-category_${tag}.pdf`, caption: 'Weekly Budget vs Actual — by sub-category', pdf: buildWeeklyDetailPdf({ ...base, prev }, 'subcategory') },
  ]
  const worthReporting = (x: { budget: number; spent: number }) => x.budget !== 0 || x.spent !== 0
  for (const g of result.groups) {
    const live = g.projects.filter(worthReporting)
    if (live.length === 0) continue
    const isRealGroup = g.name !== UNGROUPED && live.length > 1
    if (isRealGroup) {
      files.push({
        name: groupPdfFilename({ ...g, projects: live }, freshness.budget),
        caption: `${displayGroupName(g.name)} — Budget vs Actual · ${live.length} lines, week to ${tag}`,
        pdf: buildWeeklyDetailPdf({ ...base, prev, onlyGroup: displayGroupName(g.name) }, 'category'),
      })
      continue
    }
    for (const p of live) {
      files.push({
        name: projectPdfFilename(p, freshness.budget),
        caption: `${shownName(p)} — Budget vs Actual, week to ${tag}`,
        pdf: buildWeeklyDetailPdf({ ...base, prev, onlyProject: p.name }, 'category'),
      })
    }
  }
  let sent = 0, noGroup = false
  const errors: string[] = []
  for (const f of files) {
    const r = await sendPdfToGroup(svc, { filename: f.name, pdf: f.pdf, caption: f.caption })
    if ('skipped' in r) { if (r.skipped === 'no-group') noGroup = true; else errors.push(r.skipped) }
    else if (r.ok) sent++
    else errors.push(r.error)
  }
  return { sent, total: files.length, noGroup, errors }
}

/** The people who get the card, from the config or the management-role default. */
async function recipientsFor(svc: Svc, loaded: WeeklyLoaded): Promise<string[]> {
  const { data } = await svc.from('profiles').select('id, role, is_active').eq('is_active', true)
  const people = ((data ?? []) as Array<{ id: string; role: string; is_active: boolean }>)
  const { data: overrides } = await svc.from('user_module_roles').select('user_id, role').eq('module_slug', 'cost-control')
  const ov = new Map(((overrides ?? []) as Array<{ user_id: string; role: string }>).map(r => [r.user_id, r.role]))
  return resolveRecipients(loaded.cfg, people.map(p => ({ id: p.id, ccRole: ov.get(p.id) ?? p.role, active: p.is_active }))).map(r => r.id)
}

/** Card + in-app + e-mail via notify_user() — one call per recipient, so every channel rule applies. */
async function notifyRecipients(svc: Svc, loaded: WeeklyLoaded, userIds: string[]): Promise<{ sent: number; reason?: string; error?: string }> {
  const report = buildBudgetV2Report(loaded.result, loaded.freshness, Date.now(), loaded.delta)
  if (!report) return { sent: 0, reason: 'no-budget-data' }
  let sent = 0
  for (const id of userIds) {
    const { error } = await svc.rpc('notify_user', {
      p_user_id: id, p_type: WEEKLY_EVENT, p_title: report.title, p_body: report.body,
      p_url: '/cost-control', p_module_slug: 'cost-control', p_doc_table: 'projects', p_doc_id: null,
      p_data: { card_spec: report.cardSpec, report_text: report.reportText },
    })
    if (error) return { sent, error: error.message }
    sent++
  }
  return { sent }
}

/** Save this send as next week's baseline and mark the week done. */
async function markSent(svc: Svc, loaded: WeeklyLoaded, week: string): Promise<void> {
  await svc.from('budget_v2_weekly_snapshot').upsert(
    { week_ending: week, captured_at: new Date().toISOString(), totals: { snapshot: snapshotOf(loaded.result), tree: loaded.result } },
    { onConflict: 'week_ending' },
  )
  await svc.from('app_settings').upsert(
    { key: WEEKLY_CONFIG_KEY, value: serializeWeeklyConfig({ ...loaded.cfg, lastSentWeek: week }) },
    { onConflict: 'key' },
  )
}

/** The real Monday send: card to every recipient, PDFs to the group if on, then mark the week. */
async function sendWeekly(svc: Svc, nowMs: number): Promise<{ ok: true; sent: number; group?: string; week: string; reason?: string } | { ok: false; reason: string }> {
  const loaded = await loadWeeklyReport(svc, nowMs)
  const week = mondayOf(nowMs)
  const ids = await recipientsFor(svc, loaded)
  const n = await notifyRecipients(svc, loaded, ids)
  if (n.error) return { ok: false, reason: n.error }
  let group: string | undefined
  if (loaded.cfg.groupPdfs) {
    const g = await sendPdfsToGroup(svc, loaded)
    group = g.noGroup ? 'no-group' : `pdfs:${g.sent}/${g.total}${g.errors.length ? ` err:${g.errors.join('|')}` : ''}`
  }
  await markSent(svc, loaded, week)
  return { ok: true, sent: n.sent, group, week, reason: n.reason }
}

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  if (!CRON_SECRET || (req.headers.get('authorization') || '') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  }
  const now = Date.now()
  if (!isMondayIST(now)) return NextResponse.json({ ok: true, skipped: 'not-monday' })
  const svc = serviceClient()
  // Once a week, whatever the dispatcher's ledger does.
  const { data: cfgRow } = await svc.from('app_settings').select('value').eq('key', WEEKLY_CONFIG_KEY).maybeSingle()
  const last = cfgRow?.value ? (JSON.parse(cfgRow.value as string) as { lastSentWeek?: string | null }).lastSentWeek : null
  if (last === mondayOf(now)) return NextResponse.json({ ok: true, skipped: 'already-sent-this-week', week: last })
  const res = await sendWeekly(svc, now)
  return NextResponse.json(res, { status: res.ok ? 200 : 500 })
}

export async function POST(req: Request) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  }
  const body = await req.json().catch(() => ({} as { onlyMe?: boolean; group?: boolean; sendNow?: boolean }))
  const svc = serviceClient()

  if (body?.sendNow) {
    const res = await sendWeekly(svc, Date.now())
    return NextResponse.json(res, { status: res.ok ? 200 : 500 })
  }
  const loaded = await loadWeeklyReport(svc)
  if (body?.group) {
    if (loaded.result.groups.length === 0) return NextResponse.json({ ok: false, reason: 'Nothing budgeted to report yet.' }, { status: 500 })
    const g = await sendPdfsToGroup(svc, loaded)
    if (g.noGroup) return NextResponse.json({ ok: false, reason: 'No reports group is connected yet.' }, { status: 500 })
    if (g.sent === 0) return NextResponse.json({ ok: false, reason: g.errors[0] ? `Telegram: ${g.errors[0]}` : 'Nothing sent.' }, { status: 500 })
    return NextResponse.json({ ok: true, sent: g.sent, total: g.total })
  }
  // Preview: the card to the caller only. Nothing is marked, no baseline is saved.
  const me = await getMyUser()
  if (!me?.id) return NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401 })
  const n = await notifyRecipients(svc, loaded, [me.id])
  if (n.error) return NextResponse.json({ ok: false, reason: n.error }, { status: 500 })
  return NextResponse.json({ ok: true, sent: n.sent, reason: n.reason })
}
