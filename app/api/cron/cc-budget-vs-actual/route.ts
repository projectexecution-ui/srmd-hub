// Weekly "Budget vs Actual" report to management — now mirrors the Budget vs
// Actual V2 tree (Group -> Project, Budget / Spent / Outstanding + ₹/sft).
//
// The tree is composed in TypeScript (loadBudgetV2 -> composeBudgetV2) so the
// card is byte-identical to what the /budget-vs-actual-v2 page shows; the card
// is then handed to cc_budget_vs_actual_report(), a thin confidentiality-gated
// fan-out to every CC management/reviewer. Fired by the cron dispatcher; self-
// gates to Monday IST (the BPH source refreshes weekly). POST lets a cost-control
// admin preview it to their own Telegram on demand (onlyMe).

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getMyUser, getMyPermissions, can } from '@/lib/auth'
import { loadBudgetV2 } from '@/lib/budget-v2-load'
import { buildBudgetV2Report } from '@/lib/budget-v2-report'
import { buildWeeklyOnePagerPdf, buildWeeklyDetailPdf, projectPdfFilename, groupPdfFilename, displayGroupName, UNGROUPED } from '@/lib/budget-v2-pdf'
import { sendPdfToGroup } from '@/lib/telegram/group'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function serviceClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

// Build the 3 weekly PDFs (one-pager, by category, by sub-category) and post
// them to the reports group. Same loadBudgetV2 result as the tree/print pages,
// so the numbers can't drift.
async function sendPdfsToGroup(
  svc: ReturnType<typeof serviceClient>,
  loaded: Awaited<ReturnType<typeof loadBudgetV2>>,
): Promise<{ sent: number; total: number; noGroup: boolean; errors: string[] }> {
  const { result, freshness, delta, prevSnapshotWeek, prev } = loaded
  const base = { result, freshness, delta, prevSnapshotWeek }
  const tag = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)
  const files = [
    { name: `Budget-vs-Actual_One-pager_${tag}.pdf`, caption: 'Weekly Budget vs Actual — one-pager', pdf: buildWeeklyOnePagerPdf(base) },
    { name: `Budget-vs-Actual_By-Category_${tag}.pdf`, caption: 'Weekly Budget vs Actual — by category', pdf: buildWeeklyDetailPdf({ ...base, prev }, 'category') },
    { name: `Budget-vs-Actual_By-Sub-category_${tag}.pdf`, caption: 'Weekly Budget vs Actual — by sub-category', pdf: buildWeeklyDetailPdf({ ...base, prev }, 'subcategory') },
  ]

  // ...then the forwardable files. The merged reports above are for reading the
  // portfolio; these are for passing on — an Atm Head can forward his own site
  // without also forwarding everyone else's numbers.
  //
  // A GROUP travels as one file, one page per sub-project (plus a group summary,
  // which survives because the group has 2+ projects). A standalone project gets
  // its own file. That keeps the weekly to a handful of attachments instead of
  // one per project.
  const worthReporting = (x: { budget: number; spent: number }) => x.budget !== 0 || x.spent !== 0

  for (const g of result.groups) {
    const live = g.projects.filter(worthReporting)
    if (live.length === 0) continue

    // Ungrouped is not a real group — those are individual projects.
    const isRealGroup = g.name !== UNGROUPED && live.length > 1
    if (isRealGroup) {
      files.push({
        name: groupPdfFilename({ ...g, projects: live }, freshness.budget),
        caption: `${displayGroupName(g.name)} — Budget vs Actual · ${live.length} projects, week to ${tag}`,
        pdf: buildWeeklyDetailPdf({ ...base, prev, onlyGroup: displayGroupName(g.name) }, 'category'),
      })
      continue
    }

    for (const p of live) {
      files.push({
        name: projectPdfFilename(p, freshness.budget),
        caption: `${p.name} — Budget vs Actual, week to ${tag}`,
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

// Notify management (in-app + email + DM) via the RPC, and — when `toGroup` — post
// the 3 weekly PDFs to the reports group (the weekly cron, not the admin preview).
async function sendReport(
  onlyUser: string | null,
  toGroup: boolean,
): Promise<{ ok: true; sent: number; reason?: string; group?: string } | { ok: false; reason: string }> {
  const svc = serviceClient()
  const loaded = await loadBudgetV2(svc)
  const report = buildBudgetV2Report(loaded.result, loaded.freshness, Date.now(), loaded.delta)
  if (!report) return { ok: true, sent: 0, reason: 'no-budget-data' }

  const { data, error } = await svc.rpc('cc_budget_vs_actual_report', {
    p_title: report.title,
    p_body: report.body,
    p_card_spec: report.cardSpec,
    p_report_text: report.reportText,
    p_only_user: onlyUser,
  })
  if (error) return { ok: false, reason: error.message }

  // Post the 3 PDF reports to the management group, if one is registered.
  let group: string | undefined
  if (toGroup) {
    const g = await sendPdfsToGroup(svc, loaded)
    group = g.noGroup ? 'no-group' : `pdfs:${g.sent}/${g.total}${g.errors.length ? ` err:${g.errors.join("|")}` : ""}`
  }
  return { ok: true, sent: (data as number) ?? 0, group }
}

export async function GET(req: Request) {
  const CRON_SECRET = process.env.CRON_SECRET
  if (!CRON_SECRET || (req.headers.get('authorization') || '') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ ok: false, reason: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  }
  // Weekly — Monday only (IST). 1 = Monday.
  const istDow = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCDay()
  if (istDow !== 1) return NextResponse.json({ ok: true, skipped: 'not-monday' })

  const res = await sendReport(null, true)
  return NextResponse.json(res, { status: res.ok ? 200 : 500 })
}

// Post the 3 real PDF reports ONLY to the registered management group (no DM
// fan-out) — the "send a test to the group" button.
async function sendToGroupOnly(): Promise<{ ok: true; sent: number } | { ok: false; reason: string }> {
  const svc = serviceClient()
  const loaded = await loadBudgetV2(svc)
  if (loaded.result.groups.length === 0) return { ok: false, reason: 'Nothing budgeted to report yet.' }
  const g = await sendPdfsToGroup(svc, loaded)
  if (g.noGroup) return { ok: false, reason: 'No reports group is connected yet.' }
  if (g.sent === 0) return { ok: false, reason: g.errors[0] ? `Telegram: ${g.errors[0]}` : 'Nothing sent.' }
  return { ok: true, sent: g.sent }
}

// Admin on-demand. `onlyMe` DMs the caller a preview; `group` posts a test card
// to the registered management group (no DMs).
export async function POST(req: Request) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  }
  const body = await req.json().catch(() => ({} as { onlyMe?: boolean; group?: boolean }))

  if (body?.group) {
    const res = await sendToGroupOnly()
    return NextResponse.json(res, { status: res.ok ? 200 : 500 })
  }

  let onlyUser: string | null = null
  if (body?.onlyMe) {
    const me = await getMyUser()
    onlyUser = me?.id ?? null
  }
  // Admin preview stays a DM to the caller — never touches the group.
  const res = await sendReport(onlyUser, false)
  return NextResponse.json(res, { status: res.ok ? 200 : 500 })
}
