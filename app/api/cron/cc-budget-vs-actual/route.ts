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

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function serviceClient() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
}

// Build the V2 tree card and fan it out via the RPC. `onlyUser` limits delivery
// to a single recipient (admin preview). Returns the count sent (0 if there's
// nothing budgeted to report).
async function sendReport(onlyUser: string | null): Promise<{ ok: true; sent: number; reason?: string } | { ok: false; reason: string }> {
  const svc = serviceClient()
  const { result, freshness, delta } = await loadBudgetV2(svc)
  const report = buildBudgetV2Report(result, freshness, Date.now(), delta)
  if (!report) return { ok: true, sent: 0, reason: 'no-budget-data' }

  const { data, error } = await svc.rpc('cc_budget_vs_actual_report', {
    p_title: report.title,
    p_body: report.body,
    p_card_spec: report.cardSpec,
    p_report_text: report.reportText,
    p_only_user: onlyUser,
  })
  if (error) return { ok: false, reason: error.message }
  // Δ baseline comes automatically from the previous upload in budget_hub_state_history
  // (see loadBudgetV2) — nothing to capture here.
  return { ok: true, sent: (data as number) ?? 0 }
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

  const res = await sendReport(null)
  return NextResponse.json(res, { status: res.ok ? 200 : 500 })
}

// Admin on-demand preview. `onlyMe: true` sends only to the calling admin.
export async function POST(req: Request) {
  const perms = await getMyPermissions()
  if (!can(perms, 'cost-control', 'admin')) {
    return NextResponse.json({ ok: false, reason: 'Forbidden — admin only' }, { status: 403 })
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })
  }
  const body = await req.json().catch(() => ({} as { onlyMe?: boolean }))
  let onlyUser: string | null = null
  if (body?.onlyMe) {
    const me = await getMyUser()
    onlyUser = me?.id ?? null
  }
  const res = await sendReport(onlyUser)
  return NextResponse.json(res, { status: res.ok ? 200 : 500 })
}
