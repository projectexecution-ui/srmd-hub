import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadCategories } from '@/lib/masters'
import { MasterTable, type MasterRow } from '../MasterTable'

export const dynamic = 'force-dynamic'

/** Work categories: the hub's disciplines and sub-skills against IN4's
 *  ENGG_SKILLS_LOOKUP, matched by the numeric code both use. The budget feed
 *  merges on these codes, so a code that means one thing here and another in
 *  IN4 moves money onto the wrong line — this is where that shows. */
export default async function CategoriesMasterPage() {
  await requirePermission('admin-settings', 'view', '/admin')
  const { rows: cats, synced } = await loadCategories()

  const count = (s: string) => cats.filter(r => r.state === s).length
  const stats = [
    { label: 'Agree', n: count('both'), tone: 'ok' },
    { label: 'Same code, other name', n: count('name-differs'), tone: 'warn' },
    { label: 'IN4 only', n: count('in4-only'), tone: 'muted' },
    { label: 'Hub only', n: count('hub-only'), tone: 'warn' },
  ]
  const label: Record<string, string> = { both: 'agree', 'name-differs': 'name differs', 'in4-only': 'IN4 only', 'hub-only': 'hub only' }

  const rows: MasterRow[] = cats.map(c => ({
    id: `${c.level}:${c.code}`,
    tone: c.state === 'name-differs' || c.state === 'hub-only' || c.in4Duplicates ? 'warn' : c.state === 'in4-only' ? 'info' : undefined,
    cells: {
      code: { text: c.code, mono: true, tone: 'strong', sub: c.level === 'sub-skill' && c.parentCode ? `under ${c.parentCode}` : undefined },
      level: { text: c.level === 'category' ? 'Category' : 'Sub-skill', tone: 'muted' },
      hub: c.hubName ? { text: c.hubName } : { text: 'not in hub', tone: 'missing' },
      in4: c.in4Name ? { text: c.in4Name, sub: c.in4Duplicates ? `IN4 also has: ${c.in4Duplicates.join('; ')}` : undefined } : { text: 'not in IN4', tone: 'missing' },
      state: { text: c.in4Duplicates ? 'duplicate code in IN4' : label[c.state], tone: c.state === 'both' && !c.in4Duplicates ? 'good' : 'warn' },
    },
  }))

  return (
    <div className="space-y-4">
      <PageHeader title="Work categories" subtitle={synced ? `${cats.length} codes across the hub and IN4. Edit the hub's list at Cost Control → Work categories; IN4's list is IN4's.` : 'IN4 has not been mirrored yet — showing the hub list only.'} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stats.map(s => (
          <div key={s.label} className={`rounded-lg border px-3 py-2 ${s.tone === 'warn' && s.n > 0 ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-white'}`}>
            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{s.label}</p>
            <p className="text-base font-bold tabular-nums mt-0.5 text-gray-900">{s.n}</p>
          </div>
        ))}
      </div>
      {cats.some(c => c.in4Duplicates) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          IN4 carries two categories with the same code ({cats.filter(c => c.in4Duplicates).map(c => c.code).join(', ')}). The budget sync cannot tell them apart by code, so those lines are matched by name. Raised with In4Velocity — see <Link href="/admin/in4" className="underline">IN4 live sync</Link>.
        </div>
      )}
      <MasterTable
        columns={[
          { key: 'code', label: 'Code', width: 'w-24' },
          { key: 'level', label: 'Level', width: 'w-24' },
          { key: 'hub', label: 'Hub name' },
          { key: 'in4', label: 'IN4 name' },
          { key: 'state', label: 'State', width: 'w-36' },
        ]}
        sortableKeys={['code', 'hub', 'in4', 'state']}
        rows={rows}
        filters={[
          { key: 'differs', label: 'Name differs', test: r => r.cells.state.text === 'name differs' },
          { key: 'in4-only', label: 'IN4 only', test: r => r.cells.state.text === 'IN4 only' },
          { key: 'hub-only', label: 'Hub only', test: r => r.cells.state.text === 'hub only' },
          { key: 'cat', label: 'Categories', test: r => r.cells.level.text === 'Category' },
        ]}
        searchPlaceholder="Search a code or name…"
        emptyMessage="No categories."
      />
    </div>
  )
}
