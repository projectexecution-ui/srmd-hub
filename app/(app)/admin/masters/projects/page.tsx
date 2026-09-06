import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadProjectMaster } from '@/lib/masters'
import { formatDate, formatNumber } from '@/lib/utils'
import { formatINR } from '@/lib/budget-utils'
import { MasterTable, type MasterRow } from '../MasterTable'
import { UseIn4AreaButton } from './UseIn4AreaButton'

export const dynamic = 'force-dynamic'

/** The project registry with its IN4 side beside it: which IN4 sub-projects
 *  feed each hub project (through Admin → Name mapping), IN4's construction
 *  area and budget, and the hub fields still empty. Where the hub has no area
 *  and IN4 has one, one click copies it across — ₹/sft appears everywhere. */
export default async function ProjectsMasterPage() {
  await requirePermission('admin-settings', 'view', '/admin')
  const { rows: projects, in4Unmapped } = await loadProjectMaster()

  const missing = (f: (r: typeof projects[number]) => boolean) => projects.filter(f).length
  const gaps = [
    { label: 'No area', n: missing(r => !r.builtUpSft), sub: `${missing(r => !r.builtUpSft && !!r.in4?.areaFt)} fixable from IN4` },
    { label: 'No IN4 link', n: missing(r => !r.in4) },
    { label: 'No target date', n: missing(r => !r.targetDate) },
    { label: 'No manager', n: missing(r => !r.hasPm) },
  ]
  const miss = { text: 'missing', tone: 'missing' as const }

  const rows: MasterRow[] = projects.map(p => ({
    id: p.id,
    href: `/project/${p.id}`,
    tone: p.filled < 50 ? 'warn' : undefined,
    cells: {
      name: { text: p.name, tone: 'strong', sub: [p.code, p.parent].filter(Boolean).join(' · ') || undefined },
      in4: p.in4 ? { text: p.in4.subprojects.length === 1 ? p.in4.subprojects[0] : `${p.in4.subprojects.length} sub-projects`, tone: 'muted', sub: p.in4.exCodes.join(', ') || undefined } : { text: 'not linked', tone: 'missing' },
      area: p.builtUpSft ? { text: formatNumber(p.builtUpSft), sub: 'sft' } : miss,
      in4area: p.in4?.areaFt ? { text: formatNumber(p.in4.areaFt), sub: 'sft in IN4', tone: 'muted' } : { text: '' },
      budget: p.in4?.budget ? { text: formatINR(p.in4.budget), tone: 'muted' } : { text: '' },
      type: p.projectType ? { text: p.projectType, tone: 'muted' } : miss,
      start: p.startDate ? { text: formatDate(p.startDate) } : miss,
      target: p.targetDate ? { text: formatDate(p.targetDate) } : miss,
      filled: { text: `${p.filled}%`, tone: p.filled >= 80 ? 'good' : p.filled >= 50 ? 'warn' : 'missing' },
    },
    action: !p.builtUpSft && p.in4?.areaFt ? <UseIn4AreaButton projectId={p.id} sft={p.in4.areaFt} /> : undefined,
  }))

  return (
    <div className="space-y-4">
      <PageHeader title="Projects" subtitle={`${projects.length} live projects · ${projects.filter(p => p.in4).length} linked to IN4 sub-projects.`} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {gaps.map(g => (
          <div key={g.label} className={`rounded-lg border px-3 py-2 ${g.n > 0 ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-white'}`}>
            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{g.label}</p>
            <p className={`text-base font-bold tabular-nums mt-0.5 ${g.n > 0 ? 'text-amber-900' : 'text-gray-900'}`}>{g.n}</p>
            <p className="text-[11px] text-gray-400">{g.sub ?? `of ${projects.length}`}</p>
          </div>
        ))}
      </div>

      {in4Unmapped.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/60 px-4 py-3 text-xs text-blue-900">
          <b>{in4Unmapped.length} active IN4 sub-projects are not mapped to any hub project</b> (and not marked &ldquo;not ours&rdquo;): {in4Unmapped.slice(0, 8).map(s => s.name).join(', ')}{in4Unmapped.length > 8 ? ', …' : ''}.
          {' '}Decide each on <Link href="/admin/masters/mapping" className="underline">Name mapping</Link>.
        </div>
      )}

      <MasterTable
        columns={[
          { key: 'name', label: 'Project' },
          { key: 'in4', label: 'IN4 sub-project(s)' },
          { key: 'area', label: 'Area', align: 'right', width: 'w-28' },
          { key: 'in4area', label: 'IN4 area', align: 'right', width: 'w-28', desktopOnly: true },
          { key: 'budget', label: 'IN4 budget', align: 'right', width: 'w-32', desktopOnly: true },
          { key: 'type', label: 'Type', width: 'w-28', desktopOnly: true },
          { key: 'start', label: 'Start', width: 'w-28', desktopOnly: true },
          { key: 'target', label: 'Target', width: 'w-28' },
          { key: 'filled', label: 'Filled', align: 'right', width: 'w-20' },
        ]}
        sortableKeys={['name', 'area', 'filled', 'budget']}
        rows={rows}
        filters={[
          { key: 'no-area', label: 'No area', test: r => r.cells.area.text === 'missing' },
          { key: 'no-in4', label: 'No IN4 link', test: r => r.cells.in4.text === 'not linked' },
          { key: 'gaps', label: 'Under half filled', test: r => r.tone === 'warn' },
        ]}
        searchPlaceholder="Search a project by name, code or IN4 sub-project…"
        emptyMessage="No live projects."
      />
    </div>
  )
}
