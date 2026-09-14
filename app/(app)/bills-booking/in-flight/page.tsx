import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { Clock } from 'lucide-react'
import { buildInFlight, IN_FLIGHT, type FlightCert, type FlightEvent } from '@/lib/bills-booking/in-flight'
import { SanctionButton } from './SanctionButton'
import { formatINR } from '@/lib/utils'
import { loadOutOfScope, rowOutOfScope, SCOPE_NOTE } from '@/lib/bills-booking/scope'

export const dynamic = 'force-dynamic'

const LIVE = IN_FLIGHT.map(s => s.status)

/** Bills that are still moving, and who is sitting on each one.
 *
 *  Admin only. The desk column is the new part: until the approval trail was
 *  mirrored, CT Hub knew a bill's state but not who put it there or when, so
 *  "nineteen days at the Atm desk" could not be said. */
export default async function InFlightPage() {
  await requireBillsAccess()
  const supabase = await createClient()

  const { data: certData, error: certErr } = await supabase
    .from('in4_wo_certificates')
    .select('certificate_id, kind, display_no, wo_no, contractor_name, project_id, subproject_id, status_name, outstanding_amt, creation_dt')
    .in('status_name', LIVE)

  const excluded = await loadOutOfScope(supabase)
  const certs = ((certData ?? []) as FlightCert[]).filter(c => !rowOutOfScope(excluded, c.subproject_id))

  // Only the trail rows for the bills on screen — the full mirror is ~16,000
  // movements and all but a few hundred belong to bills that are long paid.
  let events: FlightEvent[] = []
  let evErr: string | null = null
  if (certs.length) {
    const ids = certs.map(c => c.certificate_id)
    const { data, error } = await supabase
      .from('in4_cert_events')
      .select('certificate_id, at, status_name, actor_name, remark')
      .in('certificate_id', ids)
    if (error) evErr = error.message
    events = (data ?? []) as FlightEvent[]
  }

  const { data: sanctioned } = await supabase
    .from('bb_sanctions').select('certificate_id').is('superseded_by', null)
  const already = new Set((sanctioned ?? []).map(r => r.certificate_id as number))

  if (certErr) return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="In flight" back="/bills-booking" />
      <QueryError message={certErr.message} />
    </div>
  )

  const { rows, byStatus, totals, haveTrail } = buildInFlight(certs, events)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="In flight"
        subtitle="Bills still moving, and the desk each one is sitting at. Admin only."
        back="/bills-booking"
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={<Clock className="h-8 w-8" />}
          title="Nothing in flight"
          description="No certificate is at a live desk, or the IN4 mirror has not synced yet."
        />
      ) : (
        <>
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <div className="flex flex-wrap divide-x divide-gray-200">
              {byStatus.map(s => (
                <div key={s.status} className="px-4 py-3 flex-1 min-w-[150px]">
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{s.status}</div>
                  <div className="text-lg font-medium tabular-nums">{formatINR(s.outstanding)}</div>
                  <div className="text-[11px] text-gray-500">
                    {s.bills} {s.bills === 1 ? 'bill' : 'bills'} · {s.desk}
                  </div>
                  {s.oldestAtDesk != null && (
                    <div className={`text-[11px] mt-0.5 ${s.oldestAtDesk > 30 ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                      longest wait {s.oldestAtDesk} d
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {evErr ? (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              The bills below are right, but the approval trail could not be read, so <b>At desk</b> and
              <b> Last moved by</b> are blank: {evErr}
            </p>
          ) : !haveTrail ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              The approval trail has not synced yet, so the desk wait and who moved each bill are blank.
              They fill on the next IN4 sync — <Link href="/admin/in4" className="underline">run the <b>trail</b> feed</Link> to do it now.
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold px-3 py-2">Certificate</th>
                  <th className="text-left font-semibold px-3 py-2">Contractor</th>
                  <th className="text-left font-semibold px-3 py-2">Work order</th>
                  <th className="text-right font-semibold px-3 py-2">Payable</th>
                  <th className="text-left font-semibold px-3 py-2">With</th>
                  <th className="text-right font-semibold px-3 py-2">At desk</th>
                  <th className="text-right font-semibold px-3 py-2">Age</th>
                  <th className="text-left font-semibold px-3 py-2">Last moved by</th>
                  <th className="text-right font-semibold px-3 py-2">Sanction</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.certificateId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-[11px]">{r.displayNo}</td>
                    <td className="px-3 py-2">{r.contractor}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-gray-500">{r.woNo ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(r.outstanding)}</td>
                    <td className="px-3 py-2">
                      <span className="text-xs">{r.desk}</span>
                      <span className="block text-[10.5px] text-gray-400">{r.status}</span>
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.atDesk != null && r.atDesk > 30 ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                      {r.atDesk == null ? '—' : `${r.atDesk} d`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{r.age} d</td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {r.movedBy ?? '—'}
                      {r.remark ? <span className="block text-[10.5px] text-gray-400">“{r.remark}”</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {already.has(r.certificateId)
                        ? <span className="text-[11px] font-semibold text-emerald-700">Sanctioned</span>
                        : <SanctionButton certificateId={r.certificateId} amount={r.outstanding} displayNo={r.displayNo} />}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>{totals.bills} bills in flight</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(totals.outstanding)}</td>
                  <td className="px-3 py-2" colSpan={5}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-gray-500">
            <b>At desk</b> is the gap since the bill last moved, from IN4&apos;s own approval trail —
            not the same as <b>age</b>, which runs from the day the bill was raised. Paid, part-paid,
            cancelled and reversed certificates are not here; held and sent-back ones are, because those are
            the ones that go quiet. {SCOPE_NOTE}
          </p>
        </>
      )}
    </div>
  )
}
