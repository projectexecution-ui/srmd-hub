import { createClient } from '@/lib/supabase/server'
import { requireBillsAccess } from '@/lib/bills-booking/access'
import { PageHeader } from '@/components/PageHeader'
import { QueryError } from '@/components/ui/query-error'
import { EmptyState } from '@/components/ui/empty-state'
import { Landmark } from 'lucide-react'
import { loadLaneData } from '@/lib/bills-booking/load-lanes'
import { retentionLane, RETENTION_QUIET_DAYS } from '@/lib/bills-booking/lanes'
import { formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** Retention held back, per work order. A tracking lane — it blocks nothing
 *  and queues nobody. It opens on the money that has gone quiet; retention on
 *  work billed this quarter is correctly held and is hidden. */
export default async function RetentionPage({
  searchParams,
}: { searchParams: Promise<{ all?: string }> }) {
  await requireBillsAccess()
  const sb = await createClient()
  const showAll = (await searchParams).all === '1'

  const { wos, rolls, names, error } = await loadLaneData(sb)
  if (error) return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader title="Retention held" back="/bills-booking" />
      <QueryError message={error} />
    </div>
  )

  const lane = retentionLane(wos, rolls)
  const rows = showAll ? lane.rows : lane.rows.filter(r => (r.quiet ?? 0) >= RETENTION_QUIET_DAYS)

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Retention held"
        subtitle="Money deducted from contractors and not yet given back. Tracking only — nothing here blocks a bill."
        back="/bills-booking"
      />

      {lane.rows.length === 0 ? (
        <EmptyState icon={<Landmark className="h-8 w-8" />} title="No retention outstanding"
          description="Either every deduction has been released, or the IN4 mirror has not synced." />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-xl overflow-hidden border border-gray-200 bg-gray-200">
            <Stat k="Held in total" v={formatINR(lane.totals.held)} s={`${lane.totals.wos} work orders`} />
            <Stat k="Quiet 6 months +" v={formatINR(lane.shown.held)} s={`${lane.shown.wos} work orders`} />
            <Stat k="On live work" v={formatINR(lane.active.held)} s={`${lane.active.wos} billed inside 3 months`} />
            {/* Was a hardcoded "0" for due-back dates. True today, but a typed
                literal cannot notice when it stops being true, and IN4's
                retention-expiry field is not mirrored at all so there is
                nothing to count. This one is computed from the rows on screen. */}
            <Stat k="No final bill" v={String(lane.rows.filter(r => !r.hasFinal).length)}
                  s="of these work orders were never closed out" />
          </div>

          <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto">
            <div className="flex divide-x divide-gray-200 min-w-max">
              {lane.buckets.map(b => (
                <div key={b.band} className="px-4 py-2.5 min-w-[140px]">
                  <div className="text-[11px] text-gray-500">{b.band}</div>
                  <div className="text-sm font-medium tabular-nums">{formatINR(b.held)}</div>
                  <div className="text-[11px] text-gray-400">{b.wos} WOs</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-gray-500">
              {showAll
                ? `Showing all ${lane.rows.length} work orders holding retention.`
                : `Showing ${rows.length} quiet ${RETENTION_QUIET_DAYS} days or more. ${formatINR(lane.active.held)} on work billed inside three months is hidden — correctly held, nothing to do.`}
            </p>
            <a href={showAll ? '/bills-booking/retention' : '/bills-booking/retention?all=1'}
               className="text-xs font-semibold text-blue-600 hover:underline shrink-0">
              {showAll ? 'Show only the quiet money' : 'Show everything'}
            </a>
          </div>

          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <th className="text-left font-semibold px-3 py-2">Work order</th>
                  <th className="text-left font-semibold px-3 py-2">Contractor</th>
                  <th className="text-left font-semibold px-3 py-2">Project</th>
                  <th className="text-right font-semibold px-3 py-2">Held</th>
                  <th className="text-right font-semibold px-3 py-2">Quiet</th>
                  <th className="text-left font-semibold px-3 py-2">Final bill</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.woId} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono text-[11px]">{r.woNo}</td>
                    <td className="px-3 py-2">{(r.contractorId && names.contractor.get(r.contractorId)) || '—'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{(r.projectId && names.project.get(r.projectId)) || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{formatINR(r.held)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${(r.quiet ?? 0) > 365 ? 'text-red-600 font-semibold' : (r.quiet ?? 0) > 180 ? 'text-amber-600' : 'text-gray-500'}`}>
                      {r.quiet == null ? '—' : `${r.quiet} d`}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.hasFinal
                        ? <span className="text-emerald-700">written</span>
                        : <span className="text-red-600">never written</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>{rows.length} work orders</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatINR(rows.reduce((s, r) => s + r.held, 0))}</td>
                  <td className="px-3 py-2" colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="text-xs text-gray-500">
            <b>Quiet</b> is days since the last bill on that work order — the proxy for a job that has finished.
            IN4 has a retention-expiry field and it is <b>empty on every row</b>, so nothing anywhere knows when this
            money falls due. Releasing it is a Retention certificate in IN4, and closing the work order is what triggers it.
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
