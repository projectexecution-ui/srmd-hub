import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadItemMaster, loadLastPoByMaterial, lastOrderLinks } from '@/lib/revamp/masters-in4'
import { formatINR, formatDate } from '@/lib/utils'
import { MasterTable, type MasterRow } from '../MasterTable'
import { In4Note, in4Arrived } from '../In4Note'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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
  const { q = '' } = await searchParams
  // The "Warehouse vs IN4" second view went with the Warehouse module (10 Sep 2026).

  // The register from the mirror; the last PO per material live from IN4 (Aksha, 10 Sep 2026: "link it to the last used PO").
  const [{ items, types, subtypes, withHsn, active }, lastPo] = await Promise.all([loadItemMaster(), loadLastPoByMaterial()])

  const rows: MasterRow[] = items.map(i => {
    const o = lastPo.byMaterial.get(i.id) ?? null
    return {
      id: String(i.id),
      href: `/masters/rates?q=${encodeURIComponent(i.name)}`,
      tone: i.isActive ? undefined : 'warn',
      cells: {
        name: { text: i.name, tone: i.isActive ? 'strong' : 'muted', sub: [i.code, i.isActive ? null : 'inactive in IN4'].filter(Boolean).join(' · ') || undefined },
        type: { text: i.type ?? '', tone: 'muted' },
        subtype: { text: i.subtype ?? '' },
        uom: { text: i.uom ?? '' },
        hsn: i.hsn ? { text: i.hsn, mono: true } : { text: '—', tone: 'muted' },
        last: o
          ? { text: o.party ?? 'supplier not named', sub: [o.date ? formatDate(o.date) : null, o.rate != null ? `@ ${formatINR(o.rate)}` : null, o.project].filter(Boolean).join(' · ') || undefined, links: lastOrderLinks(o) }
          : { text: in4Arrived(lastPo.in4) ? 'never bought' : '—', tone: 'muted' },
      },
    }
  })
  const bought = items.filter(i => lastPo.byMaterial.has(i.id)).length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Item Master"
        subtitle={`${items.length.toLocaleString('en-IN')} materials in IN4’s register, in ${types} types and ${subtypes} sub-types.`}
      />
      <In4Note in4={lastPo.in4} error={lastPo.in4Error} what="the last purchase order of each material" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Materials', n: items.length },
          { label: 'Active', n: active },
          { label: 'Ever bought on a PO', n: bought },
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
          { key: 'hsn', label: `HSN (${withHsn} have one)`, width: 'w-28' },
          { key: 'last', label: 'Last purchase order', width: 'w-72' },
        ]}
        sortableKeys={['name', 'type', 'subtype', 'last']}
        rows={rows}
        initialQuery={q}
        filters={[
          { key: 'bought', label: 'Ever bought', test: r => r.cells.last.text !== 'never bought' && r.cells.last.text !== '—' },
          { key: 'never', label: 'Never bought', test: r => r.cells.last.text === 'never bought' },
        ]}
        exportName="items"
        searchPlaceholder="Search a material by name, code, type, sub-type or last supplier…"
        emptyMessage="No materials in the IN4 mirror yet."
        emptyHint={<Link href={`/masters/search?q=${encodeURIComponent(q)}`} className="text-indigo-700 hover:underline">Search all masters instead</Link>}
      />
    </div>
  )
}
