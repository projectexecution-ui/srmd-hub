import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { DailyReportClient, type ReportBillLite, type TrustdeskEntry } from './DailyReportClient'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requirePermission('bills-pipeline', 'view')
  const supabase = await createClient()

  const sp = await searchParams
  const dateParam = typeof sp.date === 'string' && DATE_RE.test(sp.date) ? sp.date : ''

  // Which past days do we have a saved report for? (calendar look-back)
  const { data: keyRows } = await supabase
    .from('app_settings')
    .select('key')
    .like('key', 'bills_pipeline_report_%')
  const availableDates = ((keyRows ?? []) as Array<{ key: string }>)
    .map(r => r.key.replace('bills_pipeline_report_', ''))
    .filter(d => DATE_RE.test(d))
    .sort()
    .reverse()

  const useDated = dateParam && availableDates.includes(dateParam)
  const snapKey = useDated ? `bills_pipeline_report_${dateParam}` : 'bills_pipeline_report'

  const [{ data: snap }, { data: entryRows }, { data: mapRow }] = await Promise.all([
    supabase.from('app_settings').select('value').eq('key', snapKey).maybeSingle(),
    supabase.from('bp_bill_trustdesk').select('bill_id, submission_date, courier_date, remark, is_adjust_advance'),
    supabase.from('app_settings').select('value').eq('key', 'bills_pipeline_trust_map').maybeSingle(),
  ])

  let bills: ReportBillLite[] = []
  let asOf = ''
  if (snap?.value) {
    try {
      const parsed = JSON.parse(snap.value as string) as { asOf?: string; bills?: ReportBillLite[] }
      bills = parsed.bills ?? []
      asOf = parsed.asOf ?? ''
    } catch { /* ignore malformed snapshot */ }
  }
  const selectedDate = dateParam || asOf || (availableDates[0] ?? '')

  let initialTrustMap: Record<string, string> = {}
  if (mapRow?.value) { try { initialTrustMap = JSON.parse(mapRow.value as string) as Record<string, string> } catch { initialTrustMap = {} } }

  const initialEntries: Record<string, TrustdeskEntry> = {}
  for (const r of (entryRows ?? []) as Array<Record<string, unknown>>) {
    initialEntries[r.bill_id as string] = {
      submission_date: (r.submission_date as string | null) ?? null,
      courier_date: (r.courier_date as string | null) ?? null,
      remark: (r.remark as string | null) ?? null,
      is_adjust_advance: !!r.is_adjust_advance,
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Daily Bills Report"
        subtitle="Auto from Zoho — backoffice adds submission/courier date + a remark, then shares each trust as an image"
        back="/bills-pipeline"
      />
      {bills.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          No report data{dateParam ? ` for ${dateParam}` : ''} yet. Open the <b>Bills Pipeline</b> page and click{' '}
          <b>Refresh</b> once to pull the at-Trust + today&apos;s-paid bills from Zoho, then come back here.
        </div>
      ) : (
        <DailyReportClient
          bills={bills}
          initialEntries={initialEntries}
          initialTrustMap={initialTrustMap}
          asOf={asOf}
          availableDates={availableDates}
          selectedDate={selectedDate}
        />
      )}
    </div>
  )
}
