import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadItemMaster } from '@/lib/revamp/masters-in4'
import { loadItems } from '@/lib/masters'
import { formatINR } from '@/lib/utils'
import { MasterTable, type MasterRow } from '../MasterTable'
import { LinkPicker } from '../LinkPicker'
import { ViewPills } from '../ViewPills'
import { canEditMasters } from '../admin'

export const dynamic = 'force-dynamic'

/**
 * Item Master — IN4's material register: every material with its type,
 * sub-type and unit. IN4 holds an HSN code on 7 of them; the column header
 * says so, and the rest show a quiet dash rather than 4,034 red warnings.
 *
 * Second view — "Warehouse vs IN4": the Warehouse's own item list measured
 * against IN4's register. A Warehouse item IN4 does not know was hand-typed,
 * or IN4 renamed it since; an admin pins it to the IN4 material it really is.
 */
export default async function ItemsMasterPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { q = '', view } = await searchParams
  const hub = view === 'hub'
  const pills = (
    <ViewPills base="/masters/items" view={hub ? 'hub' : 'in4'} keep={{ q }} options={[
      { key: 'in4', label: 'IN4 materials' },
      { key: 'hub', label: 'Warehouse vs IN4' },
    ]} />
  )
  if (hub) return <WarehouseVsIn4 q={q} pills={pills} />

  const { items, types, subtypes, withHsn, active } = await loadItemMaster()

  const rows: MasterRow[] = items.map(i => ({
    id: String(i.id),
    href: `/masters/rates?q=${encodeURIComponent(i.name)}`,
    tone: i.isActive ? undefined : 'warn',
    cells: {
      name: { text: i.name, tone: i.isActive ? 'strong' : 'muted', sub: [i.code, i.isActive ? null : 'inactive in IN4'].filter(Boolean).join(' · ') || undefined },
      type: { text: i.type ?? '', tone: 'muted' },
      subtype: { text: i.subtype ?? '' },
      uom: { text: i.uom ?? '' },
      hsn: i.hsn ? { text: i.hsn, mono: true } : { text: '—', tone: 'muted' },
      rate: i.rate != null && i.rate > 0 ? { text: formatINR(i.rate) } : { text: '' },
    },
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Item Master"
        subtitle={`${items.length.toLocaleString('en-IN')} materials in IN4’s register, in ${types} types and ${subtypes} sub-types.`}
      />
      {pills}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Materials', n: items.length },
          { label: 'Active', n: active },
          { label: 'Sub-types', n: subtypes },
          { label: 'With an HSN code in IN4', n: withHsn },
        ].map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[12px] text-gray-500">{s.label}</p>
            <p className="text-[15px] font-semibold tabular-nums text-gray-900">{s.n.toLocaleString('en-IN')}</p>
          </div>
        ))}
      </div>

      <MasterTable
        columns={[
          { key: 'name', label: 'Material' },
          { key: 'type', label: 'Type', width: 'w-44' },
          { key: 'subtype', label: 'Sub-type', width: 'w-44' },
          { key: 'uom', label: 'Unit', width: 'w-20' },
          { key: 'hsn', label: `HSN (${withHsn} have one)`, width: 'w-32' },
          { key: 'rate', label: 'IN4 rate', align: 'right', width: 'w-28', desktopOnly: true },
        ]}
        sortableKeys={['name', 'type', 'subtype', 'rate']}
        rows={rows}
        initialQuery={q}
        exportName="items"
        searchPlaceholder="Search a material by name, code, type or sub-type…"
        emptyMessage="No materials in the IN4 mirror yet."
        emptyHint={<Link href={`/masters/search?q=${encodeURIComponent(q)}`} className="text-indigo-700 hover:underline">Search all masters instead</Link>}
      />
    </div>
  )
}

/** The Warehouse's (and the old Inventory's) items against IN4's register. */
async function WarehouseVsIn4({ q, pills }: { q: string; pills: React.ReactNode }) {
  const [m, canEdit] = await Promise.all([loadItems(), canEditMasters()])
  const materialOptions = m.types.flatMap(t => t.subtypes.flatMap(s => s.items.map(i => ({ key: String(i.id), label: `${i.name}${i.uom ? ` (${i.uom})` : ''}${i.code ? ` · ${i.code}` : ''}` }))))
  const rows: MasterRow[] = m.unmatched.map(u => ({
    id: `${u.table}:${u.id}`,
    tone: 'warn',
    cells: {
      name: { text: u.name, tone: 'strong', sub: u.unit ?? undefined },
      list: { text: u.table === 'wh_items' ? 'Warehouse' : 'Inventory (old)', tone: 'muted' },
      state: { text: 'not in IN4', tone: 'missing' },
    },
    action: canEdit ? <LinkPicker kind="material" hubTable={u.table} hubId={u.id} current={null} options={materialOptions} /> : undefined,
  }))
  const stats = [
    { label: 'IN4 materials', n: m.in4Count },
    { label: 'Warehouse items', n: m.hub.warehouse, sub: `${m.hub.warehouseMatched.toLocaleString('en-IN')} matched to IN4` },
    { label: 'Warehouse items not in IN4', n: m.hub.warehouse - m.hub.warehouseMatched, tone: m.hub.warehouse - m.hub.warehouseMatched > 0 ? 'amber' : undefined },
    { label: 'Inventory (old) items not in IN4', n: m.hub.inventory - m.hub.inventoryMatched, tone: m.hub.inventory - m.hub.inventoryMatched > 0 ? 'amber' : undefined },
  ]
  return (
    <div className="space-y-4">
      <PageHeader title="Item Master" subtitle={m.synced ? `The Warehouse’s ${m.hub.warehouse.toLocaleString('en-IN')} items against IN4’s ${m.in4Count.toLocaleString('en-IN')} materials.` : 'IN4 has not been mirrored yet — run the Masters feed from IN4 live sync.'} />
      {pills}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stats.map(s => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
            <p className="text-[12px] text-gray-500">{s.label}</p>
            <p className={`text-[15px] font-semibold tabular-nums ${s.tone === 'amber' ? 'text-amber-700' : 'text-gray-900'}`}>{s.n.toLocaleString('en-IN')}</p>
            {s.sub && <p className="text-[12px] text-gray-400">{s.sub}</p>}
          </div>
        ))}
      </div>
      <p className="text-[12px] text-gray-500">
        A Warehouse item IN4 does not know was typed by hand, or IN4 renamed it since. {canEdit ? 'Pin each to the IN4 material it really is — the picker is on the row.' : 'An admin pins each to the IN4 material it really is, on this page.'} Items that already match need nothing.
      </p>
      <MasterTable
        columns={[
          { key: 'name', label: 'CT Hub item' },
          { key: 'list', label: 'List', width: 'w-36' },
          { key: 'state', label: 'IN4', width: 'w-32' },
        ]}
        sortableKeys={['name', 'list']}
        rows={rows}
        filters={[
          { key: 'wh', label: 'Warehouse', test: r => r.cells.list.text === 'Warehouse' },
          { key: 'inv', label: 'Inventory (old)', test: r => r.cells.list.text === 'Inventory (old)' },
        ]}
        initialQuery={q}
        exportName="items-not-in-in4"
        searchPlaceholder="Search a CT Hub item…"
        emptyMessage="Every Warehouse and Inventory item matches an IN4 material."
      />
    </div>
  )
}
