import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { vendorOf } from '@/lib/bills-booking/load-register'
import { buildDailyReport, type ReportBillInput, type ReportEvent } from '@/lib/bills-booking/daily-report'
import { formatDate, todayIST } from '@/lib/utils'
import { DailyBillsReport } from './DailyBillsReport'

export const dynamic = 'force-dynamic'

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** The Daily Bills Report, made from Bills Approval (Aksha, 14 Oct 2026).
 *
 *  What was paid that day, then what sits at each trust's accounts — the same
 *  report the Billing team sends management from Zoho today, but built from
 *  each bill's own stage history here. CT Billing types the courier /
 *  submission date and a remark; everything else fills itself. */
export default async function DailyReportPage({
  searchParams,
}: { searchParams: Promise<{ date?: string }> }) {
  const me = await requireBillsAccess()
  const sb = await createClient()

  const today = todayIST()
  const asked = (await searchParams).date
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today

  const fail = (message: string) => (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <PageHeader title="Daily bills report" back="/bills-booking" />
      <QueryError message={message} />
    </div>
  )

  // Only bills that ever reached the trust or Paid can be on the report.
  const ids = new Set<string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('bb_bill_events').select('bill_id')
      .in('to_stage', ['trust', 'paid']).range(from, from + 999)
    if (error) return fail(error.message)
    for (const e of data ?? []) ids.add(e.bill_id as string)
    if ((data ?? []).length < 1000) break
  }

  const bills: ReportBillInput[] = []
  if (ids.size) {
    const rows: Record<string, unknown>[] = []
    const events = new Map<string, ReportEvent[]>()
    const marks = new Map<string, ReportBillInput['mark']>()
    for (const part of chunk([...ids], 200)) {
      const [b, e, m] = await Promise.all([
        sb.from('bb_bills')
          .select('id, vendor_text, order_no, bill_no, trust, project_id, claimed_amount, net_amount, sanctioned_net, in4_payable, is_example, in4_hold_at, in4_hold_note, in4_processed_at')
          .in('id', part),
        sb.from('bb_bill_events').select('bill_id, to_stage, created_at').in('bill_id', part),
        sb.from('bb_report_marks').select('bill_id, sent_date, remark, trust').in('bill_id', part),
      ])
      const err = b.error ?? e.error ?? m.error
      if (err) return fail(err.message)
      rows.push(...((b.data ?? []) as Record<string, unknown>[]))
      for (const ev of e.data ?? []) {
        const id = ev.bill_id as string
        const list = events.get(id) ?? []
        // The event's own amount is the claim at that moment, not what was
        // paid — the bill's payable below is the figure to report.
        list.push({ to: ev.to_stage as string, at: ev.created_at as string, amount: null })
        events.set(id, list)
      }
      for (const mk of m.data ?? []) marks.set(mk.bill_id as string, {
        sentDate: (mk.sent_date as string | null) ?? null, remark: (mk.remark as string | null) ?? null, trust: (mk.trust as string | null) ?? null,
      })
    }

    const { data: projData } = await sb.from('projects').select('id, name')
    const projectName = new Map<string, string>((projData ?? []).map(p => [p.id as string, p.name as string]))

    for (const r of rows) {
      if (r.is_example) continue
      const id = r.id as string
      const num = (k: string) => (r[k] == null ? null : Number(r[k]))
      bills.push({
        id,
        vendor: vendorOf(r as { vendor_text: string | null; order_no: string | null; bill_no: string | null }),
        project: projectName.get(r.project_id as string) ?? '—',
        billNo: (r.bill_no as string | null) ?? null,
        trust: (r.trust as string | null) ?? null,
        amount: num('in4_payable') ?? num('sanctioned_net') ?? num('net_amount') ?? num('claimed_amount') ?? 0,
        events: events.get(id) ?? [],
        mark: marks.get(id) ?? null,
        note: r.in4_hold_at
          ? `On hold in IN4${r.in4_hold_note ? ` — ${r.in4_hold_note}` : ''}`
          : r.in4_processed_at ? 'Processed by Accounts in IN4' : null,
      })
    }
  }

  const report = buildDailyReport(bills, date)
  const canEdit = me.isAdmin || me.desks.some(d => d.desk === 'ct_billing')

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader
        title="Daily bills report"
        subtitle={`${formatDate(date)} · from Bills Approval · ${canEdit ? 'you fill the dates and remarks' : 'view only'}`}
        back="/bills-booking"
      />
      <DailyBillsReport report={report} today={today} canEdit={canEdit} />
    </div>
  )
}
