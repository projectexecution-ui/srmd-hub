// Server-side aggregation for the JMR PM dashboard.
// Three layers: SPEND (daily entries) → BILLED (bills approved+paid) → PAID (bills paid).
//
// All three are on the **GST-inclusive (cash-outflow) basis**:
//
//   SPEND  = SUM(jmr_daily_entries.amount) × (1 + GST%)
//            i.e. rate × qty + the GST we'll have to pay when contractor invoices
//   BILLED = SUM(jmr_bills.total_amount) for status IN (approved, paid)
//            i.e. invoice subtotal + GST (what the contractor's GST invoice asks for)
//   PAID   = SUM(jmr_bills.total_amount) for status = paid
//            i.e. cash actually released against those invoices
//
// We gross up SPEND with the JMR module GST rate (app_settings.jmr_gst_rate_pct,
// defaults to 18). This gives the PM the "full picture" — what we expect to spend
// end-to-end, not just the rate × qty cost which understates the cash outflow.
// When a contractor invoices the logged quantity at the logged rate, all three
// cards read the same number.
//
// The "Bills awaiting your action" list elsewhere on the dashboard
// also uses jmr_bills.total_amount — same basis, no surprise.

import { createClient } from '@/lib/supabase/server'
import { getJmrSettings } from '@/lib/jmr/settings'

export interface DashboardSnapshot {
  totals: { earned: number; billed: number; paid: number; pendingRelease: number; unbilled: number }
  perContractor: Array<{
    contractor_id: string
    name: string
    earned: number
    billed: number
    paid: number
    unbilled: number
    unpaid: number
    oldestUnbilledDays: number | null
  }>
  oldestGap: { contractorName: string; projectName: string; days: number } | null
  billsAwaitingAction: Array<{
    id: string
    bill_number: string
    contractorName: string
    total_amount: number
    status: string
    variance_flag: boolean
  }>
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const supabase = await createClient()

  // Single-shot reads, then aggregate in JS — simpler than crafting Postgres views.
  // Settings call is cached per-request so callers stacking with it pay once.
  const [entriesRes, billsRes, contractorsRes, projectsRes, settings] = await Promise.all([
    supabase
      .from('jmr_daily_entries')
      .select('contractor_id, project_id, amount, entry_date')
      .in('status', ['submitted', 'pm_approved']),
    supabase
      .from('jmr_bills')
      .select(`
        id, bill_number, contractor_id, total_amount, status, variance_flag, period_to,
        jmr_contractors ( name )
      `)
      .in('status', ['submitted', 'pm_review', 'approved', 'paid']),
    supabase.from('jmr_contractors').select('id, name'),
    supabase.from('projects').select('id, name'),
    getJmrSettings(),
  ])

  // GST gross-up multiplier for SPEND so it sits on the same cash-outflow basis
  // as BILLED + PAID. e.g. 18% → 1.18.
  const gstMul = 1 + (settings.gst_rate_pct / 100)

  const entries = entriesRes.data ?? []
  const bills = billsRes.data ?? []
  const contractors = contractorsRes.data ?? []
  const projects = projectsRes.data ?? []

  const cName = new Map(contractors.map(c => [c.id, c.name]))
  const pName = new Map(projects.map(p => [p.id, p.name]))

  // Aggregate per contractor.
  type Agg = { earned: number; billed: number; paid: number; entriesSeen: { project_id: string; entry_date: string; amount: number }[] }
  const map = new Map<string, Agg>()
  for (const e of entries) {
    const a = map.get(e.contractor_id) ?? { earned: 0, billed: 0, paid: 0, entriesSeen: [] }
    // Gross up by GST so SPEND matches the eventual cash-outflow basis of BILLED + PAID.
    a.earned += Number(e.amount) * gstMul
    a.entriesSeen.push({ project_id: e.project_id, entry_date: e.entry_date, amount: Number(e.amount) * gstMul })
    map.set(e.contractor_id, a)
  }
  for (const b of bills) {
    const a = map.get(b.contractor_id) ?? { earned: 0, billed: 0, paid: 0, entriesSeen: [] }
    // total_amount = subtotal + GST. We compare like-with-like against the
    // grossed-up SPEND above so when nothing's wrong, all three cards match.
    if (b.status === 'approved' || b.status === 'paid') a.billed += Number(b.total_amount)
    if (b.status === 'paid') a.paid += Number(b.total_amount)
    map.set(b.contractor_id, a)
  }

  let oldestGap: DashboardSnapshot['oldestGap'] = null
  const perContractor: DashboardSnapshot['perContractor'] = []
  for (const [contractor_id, a] of map) {
    const unbilled = Math.max(0, a.earned - a.billed)
    const unpaid = Math.max(0, a.billed - a.paid)

    // Crude "oldest unbilled" — find the oldest entry whose cumulative qty isn't covered by bills.
    let oldestDays: number | null = null
    if (unbilled > 0 && a.entriesSeen.length > 0) {
      const oldest = a.entriesSeen.slice().sort((x, y) => x.entry_date.localeCompare(y.entry_date))[0]
      if (oldest) {
        const days = Math.floor((Date.now() - new Date(oldest.entry_date).getTime()) / 86400000)
        oldestDays = days
        if (!oldestGap || days > oldestGap.days) {
          oldestGap = {
            contractorName: cName.get(contractor_id) ?? 'Contractor',
            projectName: pName.get(oldest.project_id) ?? 'Project',
            days,
          }
        }
      }
    }
    perContractor.push({
      contractor_id,
      name: cName.get(contractor_id) ?? 'Contractor',
      earned: a.earned, billed: a.billed, paid: a.paid,
      unbilled, unpaid,
      oldestUnbilledDays: oldestDays,
    })
  }
  perContractor.sort((a, b) => b.earned - a.earned)

  const earned = perContractor.reduce((s, c) => s + c.earned, 0)
  const billed = perContractor.reduce((s, c) => s + c.billed, 0)
  const paid = perContractor.reduce((s, c) => s + c.paid, 0)
  const pendingRelease = Math.max(0, billed - paid)
  const unbilled = Math.max(0, earned - billed)

  const billsAwaitingAction = bills
    .filter(b => b.status === 'pm_review' || (b.status === 'approved'))
    .slice(0, 10)
    .map(b => ({
      id: b.id,
      bill_number: b.bill_number,
      // @ts-expect-error supabase
      contractorName: b.jmr_contractors?.name ?? 'Contractor',
      total_amount: Number(b.total_amount),
      status: b.status,
      variance_flag: b.variance_flag,
    }))

  return {
    totals: { earned, billed, paid, pendingRelease, unbilled },
    perContractor,
    oldestGap,
    billsAwaitingAction,
  }
}
