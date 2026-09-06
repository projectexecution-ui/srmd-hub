import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadStores } from '@/lib/masters'
import { MasterTable, type MasterRow } from '../MasterTable'
import { LinkPicker } from '../LinkPicker'

export const dynamic = 'force-dynamic'

/** IN4's store list, with the Warehouse's sites and the old Inventory's
 *  warehouses matched onto it. A hub store IN4 does not know cannot receive an
 *  IN4 GRN — that is the row to fix. */
export default async function StoresMasterPage() {
  await requirePermission('admin-settings', 'view', '/admin')
  const { rows: stores, in4Count, synced } = await loadStores()
  const in4Options = stores.filter(s => s.in4Id).map(s => ({ key: String(s.in4Id), label: `${s.name}${s.code ? ` (${s.code})` : ''}` }))

  const rows: MasterRow[] = stores.map(s => ({
    id: s.key,
    tone: !s.in4Id ? 'warn' : undefined,
    cells: {
      name: { text: s.name, tone: 'strong', sub: [s.code, s.hubSources.length ? `in ${s.hubSources.join(', ')}` : s.in4Id ? 'IN4 only' : 'hub only'].filter(Boolean).join(' · ') },
      trust: s.trust ? { text: s.trust, tone: 'muted' } : { text: '' },
      owner: s.ownerProject ? { text: s.ownerProject } : { text: s.hubSources.length ? 'shared' : '', tone: 'muted' },
      keeper: s.hubSources.includes('Warehouse') ? (s.keeper ? { text: s.keeper } : { text: 'not set', tone: 'warn' }) : { text: '' },
      stock: { text: s.stockLines ? s.stockLines.toLocaleString('en-IN') : '', tone: 'muted' },
      address: { text: s.address ?? '', tone: 'muted' },
      active: { text: s.isActive ? '' : 'inactive', tone: 'warn' },
    },
    action: !s.in4Id && s.hubRefs[0] ? <LinkPicker kind="store" hubTable={s.hubRefs[0].table} hubId={s.hubRefs[0].id} current={null} options={in4Options} /> : undefined,
  }))

  return (
    <div className="space-y-4">
      <PageHeader title="Stores" subtitle={synced ? `${in4Count} stores in IN4 · ${stores.filter(s => s.in4Id && s.hubSources.length).length} also set up in the Warehouse · ${stores.filter(s => !s.in4Id).length} hub stores IN4 does not know.` : 'IN4 has not been mirrored yet — showing the hub lists only.'} />
      <MasterTable
        columns={[
          { key: 'name', label: 'Store' },
          { key: 'trust', label: 'Trust', width: 'w-24' },
          { key: 'owner', label: 'Owner project' },
          { key: 'keeper', label: 'Keeper' },
          { key: 'stock', label: 'Stock lines', align: 'right', width: 'w-24' },
          { key: 'address', label: 'Address', desktopOnly: true },
          { key: 'active', label: '', width: 'w-16' },
        ]}
        sortableKeys={['name', 'trust', 'stock']}
        rows={rows}
        filters={[
          { key: 'hub-only', label: 'Not in IN4', test: r => r.tone === 'warn' },
          { key: 'wh', label: 'In the Warehouse', test: r => (r.cells.name.sub ?? '').includes('Warehouse') },
          { key: 'no-keeper', label: 'No keeper', test: r => r.cells.keeper.text === 'not set' },
        ]}
        searchPlaceholder="Search a store by name, code, project, keeper or address…"
        emptyMessage="No stores yet."
      />
    </div>
  )
}
