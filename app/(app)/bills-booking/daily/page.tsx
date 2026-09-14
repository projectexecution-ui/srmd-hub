import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'

import { buildDaily, type DailyCert, type DailyEvent, type DailyRow } from '@/lib/bills-booking/daily'
import { formatINR, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const LIVE = ['Approved', 'Processed', 'Paid', 'Partially Paid']

/** The daily payment report, fed from IN4.
 *
 *  Same shape the Billing team already sends — what was paid, then what is
 *  sitting at each trust — but nothing is typed and the trust comes out of the
 *  work-order number instead of a map somebody has to keep. */
export default async function DailyPage({
  searchParams,
}: { searchParams: Promise<{ days?: string }> }) {
  await requireBillsAccess()
  const sb = await createClient()

  const raw = Number((await searchParams).days)
  const within = [1, 3, 7, 14].includes(raw) ? raw : 3

  const { data: certData, error } = await sb
    .from('in4_wo_certificates')
    .select('certificate_id, display_no, wo_no, contractor_name, project_id, status_name, outstanding_amt, creation_dt')
    .eq('kind', 'wo').in('status_name', LIVE)

  if (error) return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <PageHeader title="Daily payment report" back="/bills-booking" />
      <QueryError message={error.message} />
    </div>
  )

  const certs = (certData ?? []) as DailyCert[]
  let events: DailyEvent[] = []
  if (certs.length) {
    const { data } = await sb
      .from('in4_cert_events')
      .select('certificate_id, at, status_name, actor_name')
      .in('certificate_id', certs.map(c => c.certificate_id))
      .in('status_name', ['Paid', 'Approved'])
    events = (data ?? []) as DailyEvent[]
  }
  const { data: projData } = await sb.from('in4_projects').select('id, name')
  const names = new Map<number, string>((projData ?? []).map(p => [p.id as number, p.name as string]))

  const d = buildDaily(certs, events, names, { paidWithinDays: within })
  const today = formatDate(new Date().toISOString())

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader
        title="Daily payment report"
        subtitle={`${today} · read from IN4, nothing typed. Admin only.`}
        back="/bills-booking"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">Paid in the last:</span>
        {[1, 3, 7, 14].map(n => (
          <a key={n} href={`/bills-booking/daily?days=${n}`}
             className={`text-xs font-semibold rounded-lg border px-2.5 py-1 ${n === within ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
            {n === 1 ? 'today' : `${n} days`}
          </a>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700">
          Paid — last {within === 1 ? 'day' : `${within} days`}
        </h2>
        {d.paid.length === 0 ? (
          <p className="text-sm text-gray-500 rounded-xl border border-gray-200 bg-white px-4 py-6 text-center">
            Nothing marked paid in IN4 in this window.
          </p>
        ) : (
          <Table rows={d.paid} total={d.paidTotal} whenLabel="Paid on" byLabel="Marked by" amountLabel="Certificate value" />
        )}
      </section>

      {d.atTrust.map(t => (
        <section key={t.trust} className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-wide font-semibold text-blue-700">
            At trust — {t.trust} · {formatINR(t.total)}
          </h2>
          <Table rows={t.rows} total={t.total} whenLabel="Approved on" byLabel="Approved by" amountLabel="Payable" showDays />
        </section>
      ))}

      {d.unassigned.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-wide font-semibold text-amber-700">
            No trust in the work-order number
          </h2>
          <Table rows={d.unassigned} total={d.unassigned.reduce((s, r) => s + r.amount, 0)}
                 whenLabel="Approved on" byLabel="Approved by" amountLabel="Payable" showDays />
        </section>
      )}

      <p className="text-xs text-gray-500">
        The trust is taken from the work-order number itself — <span className="font-mono">WO/<b>SRASSK</b>/SQ/…</span> —
        so there is no project-to-trust map to keep up to date. Paid dates and the names beside them come from IN4&apos;s
        own approval trail, which records the second each movement happened.{' '}
        <b>Submission and courier dates stay hand-entered</b> on the{' '}
        <Link href="/bills-pipeline/daily-report" className="text-blue-600 hover:underline">Bills Pipeline report</Link> —
        they are facts about a cheque in a drawer and no database holds them.
      </p>
    </div>
  )
}

function Table({ rows, total, whenLabel, byLabel, amountLabel, showDays }: {
  rows: DailyRow[]; total: number; whenLabel: string; byLabel: string; amountLabel: string; showDays?: boolean
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
            <th className="text-left font-semibold px-3 py-2">Certificate</th>
            <th className="text-left font-semibold px-3 py-2">Vendor</th>
            <th className="text-left font-semibold px-3 py-2">Project</th>
            <th className="text-right font-semibold px-3 py-2">{amountLabel}</th>
            <th className="text-left font-semibold px-3 py-2">{whenLabel}</th>
            {showDays && <th className="text-right font-semibold px-3 py-2">Days</th>}
            <th className="text-left font-semibold px-3 py-2">{byLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.certificateId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
              <td className="px-3 py-2 font-mono text-[11px]">{r.displayNo}</td>
              <td className="px-3 py-2">{r.contractor}</td>
              <td className="px-3 py-2 text-xs text-gray-500">{r.project}</td>
              <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(r.amount)}</td>
              <td className="px-3 py-2 font-mono text-[11px] text-gray-600">{r.on ? formatDate(r.on) : '—'}</td>
              {showDays && (
                <td className={`px-3 py-2 text-right tabular-nums ${(r.days ?? 0) > 7 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                  {r.days == null ? '—' : r.days}
                </td>
              )}
              <td className="px-3 py-2 text-xs text-gray-600">{r.by ?? '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
            <td className="px-3 py-2" colSpan={3}>{rows.length} {rows.length === 1 ? 'bill' : 'bills'}</td>
            <td className="px-3 py-2 text-right tabular-nums">{formatINR(total)}</td>
            <td className="px-3 py-2" colSpan={showDays ? 3 : 2}></td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
