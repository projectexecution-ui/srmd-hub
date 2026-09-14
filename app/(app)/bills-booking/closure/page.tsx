import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { PackageCheck } from 'lucide-react'
import { loadLaneData } from '@/lib/bills-booking/load-lanes'
import { closureLane, CLOSURE_FLOOR, CLOSURE_QUIET_DAYS } from '@/lib/bills-booking/lanes'
import { formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const FLOORS = [0, 25_000, 100_000, 500_000]

/** Work orders nobody closed: no final bill, silent for months, money still on
 *  them. IN4 has no "closed" state for a work order at all — its whole status
 *  vocabulary is Approved, Terminated and Verified — which is why so many are
 *  open. A tracking lane, not a queue. */
export default async function ClosurePage({
  searchParams,
}: { searchParams: Promise<{ floor?: string }> }) {
  await requireBillsAccess()
  const sb = await createClient()

  const raw = Number((await searchParams).floor)
  const floor = FLOORS.includes(raw) ? raw : CLOSURE_FLOOR

  const { wos, rolls, names, error } = await loadLaneData(sb)
  if (error) return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="Never closed" back="/bills-booking" />
      <QueryError message={error} />
    </div>
  )

  const lane = closureLane(wos, rolls, floor)
  const pct = lane.totals.atStake > 0 ? Math.round((lane.shown.atStake / lane.totals.atStake) * 1000) / 10 : 0

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Never closed"
        subtitle={`No final bill and silent ${CLOSURE_QUIET_DAYS}+ days. Tracking only — closing one is a human decision.`}
        back="/bills-booking"
      />

      {lane.totals.wos === 0 ? (
        <EmptyState icon={<PackageCheck className="h-8 w-8" />} title="Everything is closed"
          description="Every work order with bills has a final certificate, or the IN4 mirror has not synced." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border border-gray-200 bg-gray-200">
            <Stat k="At stake" v={formatINR(lane.totals.atStake)} s={`${lane.totals.wos} work orders`} />
            <Stat k="Shown" v={formatINR(lane.shown.atStake)} s={`${lane.shown.wos} rows · ${pct}% of the money`} />
            <Stat k="Hidden below the floor" v={formatINR(lane.hidden.atStake)} s={`${lane.hidden.wos} rows of small change`} />
            <Stat k="Floor" v={floor === 0 ? 'none' : formatINR(floor)} s="money at stake per work order" />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Floor:</span>
            {FLOORS.map(f => (
              <a key={f} href={`/bills-booking/closure?floor=${f}`}
                 className={`text-xs font-semibold rounded-lg border px-2.5 py-1 ${f === floor ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
                {f === 0 ? 'Show all' : formatINR(f)}
              </a>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold px-3 py-2">Work order</th>
                  <th className="text-left font-semibold px-3 py-2">Contractor</th>
                  <th className="text-left font-semibold px-3 py-2">Project</th>
                  <th className="text-right font-semibold px-3 py-2">Ordered incl. GST</th>
                  <th className="text-right font-semibold px-3 py-2">Never billed</th>
                  <th className="text-right font-semibold px-3 py-2">Retention</th>
                  <th className="text-right font-semibold px-3 py-2">Quiet</th>
                </tr>
              </thead>
              <tbody>
                {lane.rows.map(r => (
                  <tr key={r.woId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-[11px]">{r.woNo}</td>
                    <td className="px-3 py-2">{(r.contractorId && names.contractor.get(r.contractorId)) || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{(r.projectId && names.project.get(r.projectId)) || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{formatINR(r.orderedGross)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(r.neverBilled)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.retentionHeld > 0 ? formatINR(r.retentionHeld) : '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.quiet > 365 ? 'text-red-600 font-semibold' : 'text-amber-600'}`}>{r.quiet} d</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>{lane.rows.length} work orders</td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(lane.rows.reduce((s, r) => s + r.neverBilled, 0))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(lane.rows.reduce((s, r) => s + r.retentionHeld, 0))}</td>
                  <td className="px-3 py-2"></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-gray-500">
            <b>Never billed</b> is the ordered value less everything certified, both including GST.
            <b> At stake</b> adds the retention still held. Some of these are genuinely still running — that is
            exactly why closing one has to be a person&apos;s decision and not a rule. <b>IN4 has no closed state
            for a work order</b> (Approved, Terminated, Verified is the whole vocabulary), which is why the mark
            will live here.
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ k, v, s }: { k: string; v: string; s: string }) {
  return (
    <div className="bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">{k}</div>
      <div className="text-xl font-medium tabular-nums mt-0.5">{v}</div>
      <div className="text-[11px] text-gray-500">{s}</div>
    </div>
  )
}
