import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadTrusts } from '@/lib/revamp/masters'
import { EmptyState } from '@/components/ui/empty-state'

export const dynamic = 'force-dynamic'

/** There is no trust table anywhere in CT Hub. There does not need to be one:
 *  every IN4 work-order number is WO/<TRUST>/<SITE>/<FY>/<serial>, so the trust
 *  is already in the data. This reads it back out rather than asking anyone to
 *  type a list that would immediately drift from the source. */
export default async function TrustsMasterPage() {
  await requirePermission('cost-control', 'view')
  const trusts = await loadTrusts()
  const total = trusts.reduce((s, t) => s + t.workOrders, 0)

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="Trusts"
        back="/masters"
        subtitle="Read out of the work-order numbers — nothing here was typed."
      />

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p className="text-xs text-gray-600">Every IN4 work-order number is built the same way:</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[
            { v: 'WO', l: 'fixed' },
            { v: 'SRASSK', l: 'trust', hi: true },
            { v: 'ND', l: 'site' },
            { v: '2023-24', l: 'fin. year' },
            { v: '106', l: 'serial' },
          ].map(p => (
            <div key={p.l} className={`rounded-md border px-2.5 py-1.5 text-center ${
              p.hi ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white'
            }`}>
              <p className={`font-mono text-[13px] font-medium ${p.hi ? 'text-indigo-800' : 'text-gray-800'}`}>{p.v}</p>
              <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{p.l}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          So the trust never has to be entered on a project — it can be filled in for you.
        </p>
      </div>

      {trusts.length === 0 ? (
        <EmptyState
          title="No work-order numbers read yet"
          description="Trusts appear here as soon as work orders with WO/… numbers are imported."
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {trusts.map(t => (
            <div key={t.code} className="px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900">
                  <span className="font-mono text-indigo-700 mr-2">{t.code}</span>
                  {t.name}
                </p>
                <p className="text-[11px] text-gray-400">{t.source}</p>
              </div>
              <p className="text-sm tabular-nums text-gray-600 flex-shrink-0">
                {t.workOrders.toLocaleString('en-IN')} work orders
              </p>
            </div>
          ))}
          <div className="px-4 py-2 bg-gray-50/60 text-[11px] text-gray-500">
            {total.toLocaleString('en-IN')} work orders read in total
          </div>
        </div>
      )}
    </div>
  )
}
