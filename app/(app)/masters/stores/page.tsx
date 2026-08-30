import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadStores } from '@/lib/revamp/masters'

export const dynamic = 'force-dynamic'

export default async function StoresMasterPage() {
  await requirePermission('cost-control', 'view')
  const stores = await loadStores()
  const wh = stores.filter(s => s.source === 'Warehouse')
  const inv = stores.filter(s => s.source !== 'Warehouse')
  const noKeeper = wh.filter(s => !s.keeper).length
  const shared = wh.filter(s => !s.ownerProject).length

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Stores"
        back="/masters"
        subtitle={`${stores.length} stores across two modules.`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Warehouse" value={String(wh.length)} />
        <Stat label="Inventory (old)" value={String(inv.length)} />
        <Stat label="No keeper set" value={String(noKeeper)} warn={noKeeper > 0} />
        <Stat label="Shared (no owner)" value={String(shared)} />
      </div>

      {inv.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">Two store lists, from two modules</p>
          <p className="text-xs text-amber-800 mt-1">
            Warehouse V2 keeps its own stores; the older Inventory module keeps another set.
            Stock only ever counts against the Warehouse list — the Inventory rows are names.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[200px]">Store</th>
                <th className="border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 w-36">List</th>
                <th className="border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[160px]">Owner project</th>
                <th className="border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[140px]">Keeper</th>
                <th className="border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-24">Items</th>
              </tr>
            </thead>
            <tbody>
              {stores.map(s => (
                <tr key={`${s.source}-${s.name}`} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="px-3 py-2 text-gray-900">
                    {s.code && <span className="font-mono text-[11px] text-gray-400 mr-2">{s.code}</span>}
                    {s.name}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded text-[10px] px-1.5 py-0.5 ${
                      s.source === 'Warehouse' ? 'bg-indigo-50 text-indigo-700' : 'bg-gray-100 text-gray-600'
                    }`}>{s.source}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{s.ownerProject ?? <span className="text-gray-300">shared</span>}</td>
                  <td className="px-3 py-2 text-gray-600">{s.keeper ?? <span className="text-amber-600">not set</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600">{s.items || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${warn ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-white'}`}>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${warn ? 'text-amber-900' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
