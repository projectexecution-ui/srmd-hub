import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadStores } from '@/lib/revamp/masters'
import { MasterTable, type MasterRow } from '../MasterTable'

export const dynamic = 'force-dynamic'

export default async function StoresMasterPage() {
  await requirePermission('cost-control', 'view')
  const stores = await loadStores()
  const wh = stores.filter(s => s.source === 'Warehouse')
  const inv = stores.filter(s => s.source !== 'Warehouse')
  const noKeeper = wh.filter(s => !s.keeper).length
  const shared = wh.filter(s => !s.ownerProject).length

  const rows: MasterRow[] = stores.map(s => ({
    id: `${s.source}-${s.name}`,
    tone: s.source !== 'Warehouse' ? 'warn' : undefined,
    cells: {
      name: { text: s.name, tone: 'strong', sub: s.code ?? undefined },
      list: { text: s.source, tone: s.source === 'Warehouse' ? 'muted' : 'warn' },
      owner: s.ownerProject ? { text: s.ownerProject } : { text: 'shared', tone: 'muted' },
      keeper: s.keeper ? { text: s.keeper } : { text: 'not set', tone: 'warn' },
      items: { text: s.items ? s.items.toLocaleString('en-IN') : '—', tone: 'muted' },
    },
  }))

  return (
    <div className="space-y-4">
      <PageHeader title="Stores" subtitle={`${stores.length} stores across two modules.`} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Warehouse" value={String(wh.length)} />
        <Stat label="Inventory (old)" value={String(inv.length)} warn={inv.length > 0} />
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

      <MasterTable
        columns={[
          { key: 'name', label: 'Store' },
          { key: 'list', label: 'List', width: 'w-36' },
          { key: 'owner', label: 'Owner project' },
          { key: 'keeper', label: 'Keeper' },
          { key: 'items', label: 'Items', align: 'right', width: 'w-24' },
        ]}
        sortableKeys={['name', 'items']}
        rows={rows}
        searchPlaceholder="Search a store by name, code, project or keeper…"
        emptyMessage="No stores yet."
      />
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
