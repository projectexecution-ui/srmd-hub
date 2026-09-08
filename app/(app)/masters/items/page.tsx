import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadItemMaster } from '@/lib/revamp/masters-in4'
import { formatINR } from '@/lib/utils'
import { MasterTable, type MasterRow } from '../MasterTable'

export const dynamic = 'force-dynamic'

/** Item Master — IN4's material register: every material with its type,
 *  sub-type and unit. IN4 holds an HSN code on 7 of them; the column header
 *  says so, and the rest show a quiet dash rather than 4,034 red warnings. */
export default async function ItemsMasterPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { q = '' } = await searchParams
  const { items, types, subtypes, withHsn, active } = await loadItemMaster()

  const rows: MasterRow[] = items.map(i => ({
    id: String(i.id),
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
