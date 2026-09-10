import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadStores } from '@/lib/masters'
import { MasterTable, type MasterRow } from '../MasterTable'
import { LinkPicker } from '../LinkPicker'
import { canEditMasters } from '../admin'

export const dynamic = 'force-dynamic'

/**
 * Stores — IN4's store list, with the Warehouse's sites and the old
 * Inventory's warehouses matched onto it. A hub store IN4 does not know
 * cannot receive an IN4 GRN — that is the row to fix, and an admin can pin
 * it to the IN4 store it really is, right here.
 */
export default async function StoresMasterPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { q = '' } = await searchParams
  const [{ rows: stores, in4Count, synced }, canEdit] = await Promise.all([loadStores(), canEditMasters()])
  const in4Options = stores.filter(s => s.in4Id).map(s => ({ key: String(s.in4Id), label: `${s.name}${s.code ? ` (${s.code})` : ''}` }))
  const hubOnly = stores.filter(s => !s.in4Id).length
  const noKeeper = stores.filter(s => s.hubSources.includes('Warehouse') && !s.keeper).length

  const rows: MasterRow[] = stores.map(s => ({
    id: s.key,
    tone: !s.in4Id ? 'warn' : undefined,
    cells: {
      name: { text: s.name, tone: 'strong', sub: [s.code, s.hubSources.length ? `in ${s.hubSources.join(', ')}` : s.in4Id ? 'IN4 only' : 'CT Hub only — not in IN4'].filter(Boolean).join(' · ') },
      trust: s.trust ? { text: s.trust, tone: 'muted' } : { text: '' },
      owner: s.ownerProject ? { text: s.ownerProject } : { text: s.hubSources.length ? 'shared' : '', tone: 'muted' },
      keeper: s.hubSources.includes('Warehouse') ? (s.keeper ? { text: s.keeper } : { text: 'not set', tone: 'warn' }) : { text: '' },
      stock: { text: s.stockLines ? s.stockLines.toLocaleString('en-IN') : '', tone: 'muted' },
      address: { text: s.address ?? '', tone: 'muted' },
      active: { text: s.isActive ? '' : 'inactive in IN4', tone: 'warn' },
    },
    action: canEdit && !s.in4Id && s.hubRefs[0]
      ? <LinkPicker kind="store" hubTable={s.hubRefs[0].table} hubId={s.hubRefs[0].id} current={null} options={in4Options} />
      : undefined,
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stores"
        subtitle={synced
          ? `${in4Count} stores in IN4 · ${stores.filter(s => s.in4Id && s.hubSources.length).length} also set up in the Warehouse · ${hubOnly} in CT Hub only.`
          : 'IN4 has not been mirrored yet — run the Masters feed from IN4 live sync.'}
      />
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Stores in IN4', n: in4Count },
          { label: 'In CT Hub only (cannot take an IN4 GRN)', n: hubOnly, tone: hubOnly > 0 ? 'amber' : undefined },
          { label: 'Warehouse stores with no keeper', n: noKeeper, tone: noKeeper > 0 ? 'amber' : undefined },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[12px] text-gray-500">{s.label}</p>
            <p className={`text-[15px] font-semibold tabular-nums ${s.tone === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{s.n.toLocaleString('en-IN')}</p>
          </div>
        ))}
      </div>
      {hubOnly > 0 && !canEdit && (
        <p className="text-[12px] text-gray-500">A store that exists only in CT Hub is pinned to its IN4 store by an admin, on this page.</p>
      )}
      <MasterTable
        columns={[
          { key: 'name', label: 'Store' },
          { key: 'trust', label: 'Trust', width: 'w-24' },
          { key: 'owner', label: 'Owner project' },
          { key: 'keeper', label: 'Keeper' },
          { key: 'stock', label: 'Stock lines', align: 'right', width: 'w-24' },
          { key: 'address', label: 'Address', desktopOnly: true },
          { key: 'active', label: '', width: 'w-24' },
        ]}
        sortableKeys={['name', 'trust', 'stock']}
        rows={rows}
        filters={[
          { key: 'hub-only', label: 'Not in IN4', test: r => r.tone === 'warn' },
          { key: 'wh', label: 'In the Warehouse', test: r => (r.cells.name.sub ?? '').includes('Warehouse') },
          { key: 'no-keeper', label: 'No keeper', test: r => r.cells.keeper.text === 'not set' },
        ]}
        initialQuery={q}
        exportName="stores"
        searchPlaceholder="Search a store by name, code, project, keeper or address…"
        emptyMessage="No stores yet."
        emptyHint={<Link href={`/masters/search?q=${encodeURIComponent(q)}`} className="text-indigo-700 hover:underline">Search all masters instead</Link>}
      />
    </div>
  )
}
