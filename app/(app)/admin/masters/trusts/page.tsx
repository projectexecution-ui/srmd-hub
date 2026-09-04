import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadTrusts } from '@/lib/masters'

export const dynamic = 'force-dynamic'

/** The paying companies — IN4's own list (COMMON.TBLCOMMONCOMPANY), which is
 *  what every WO, PO and certificate is raised under. Nothing typed. */
export default async function TrustsMasterPage() {
  await requirePermission('admin-settings', 'view', '/admin')
  const trusts = await loadTrusts()
  const fromIn4 = trusts.filter(t => t.id != null)
  const woOnly = trusts.filter(t => t.id == null)

  return (
    <div className="space-y-4">
      <PageHeader title="Trusts" subtitle="The paying companies, from IN4. Every work order, PO and certificate is raised under one of these." />

      {fromIn4.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">IN4's company list appears here after the Masters feed runs.</p>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {fromIn4.map(t => (
            <div key={t.code} className="px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 min-h-[44px]">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-900"><span className="font-mono text-indigo-700 mr-2">{t.code}</span>{t.name}</p>
                <p className="text-[11px] text-gray-400">{t.source} · id {t.id}</p>
              </div>
              <p className="text-xs tabular-nums text-gray-600 flex-shrink-0">{t.projects} projects · {t.stores} stores{t.workOrders ? ` · ${t.workOrders.toLocaleString('en-IN')} WOs imported` : ''}</p>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
        <p className="text-xs text-gray-600">The trust is also in every IN4 work-order number:</p>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {[{ v: 'WO', l: 'fixed' }, { v: 'SRASSK', l: 'trust', hi: true }, { v: 'ND', l: 'site' }, { v: '2023-24', l: 'fin. year' }, { v: '106', l: 'serial' }].map(p => (
            <div key={p.l} className={`rounded-md border px-2.5 py-1.5 text-center ${p.hi ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 bg-white'}`}>
              <p className={`font-mono text-[13px] font-medium ${p.hi ? 'text-indigo-800' : 'text-gray-800'}`}>{p.v}</p>
              <p className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{p.l}</p>
            </div>
          ))}
        </div>
        {woOnly.length > 0 && <p className="text-[11px] text-amber-800 mt-2">Seen in WO numbers but not in IN4&apos;s company list: {woOnly.map(t => `${t.code} (${t.workOrders})`).join(', ')}.</p>}
      </div>
    </div>
  )
}
