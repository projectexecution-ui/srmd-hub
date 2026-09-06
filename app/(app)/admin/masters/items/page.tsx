import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadItems } from '@/lib/masters'
import { ItemsTree } from './ItemsTree'

export const dynamic = 'force-dynamic'

/** Items master: IN4's material catalogue as a type → sub-type → item tree
 *  (the grouped layout the Internal Estimate uses), with each item marked
 *  where the Warehouse and the old Inventory already hold it. Under the tree,
 *  the hub items IN4 does not know — hand-typed, or renamed in IN4 since. */
export default async function ItemsMasterPage() {
  await requirePermission('admin-settings', 'view', '/admin')
  const m = await loadItems()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Items"
        subtitle={m.synced
          ? `${m.in4Count.toLocaleString('en-IN')} materials in IN4's catalogue · Warehouse ${m.hub.warehouseMatched.toLocaleString('en-IN')} of ${m.hub.warehouse.toLocaleString('en-IN')} matched · Inventory (old) ${m.hub.inventoryMatched} of ${m.hub.inventory}.`
          : 'IN4 has not been mirrored yet — run the Masters feed from IN4 live sync.'}
      />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="IN4 materials" value={m.in4Count.toLocaleString('en-IN')} />
        <Stat label="Warehouse items" value={m.hub.warehouse.toLocaleString('en-IN')} sub={`${m.hub.warehouse - m.hub.warehouseMatched} not in IN4`} warn={m.hub.warehouse - m.hub.warehouseMatched > 0} />
        <Stat label="Inventory (old)" value={String(m.hub.inventory)} sub={`${m.hub.inventory - m.hub.inventoryMatched} not in IN4`} warn={m.hub.inventory > 0} />
        <Stat label="Other lists" value={String(m.hub.estSubcategories + m.hub.jmrItems)} sub={`Rates ${m.hub.estSubcategories} · JMR ${m.hub.jmrItems}`} />
      </div>
      <ItemsTree types={m.types} unmatched={m.unmatched} />
    </div>
  )
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${warn ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-white'}`}>
      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{label}</p>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${warn ? 'text-amber-900' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}
