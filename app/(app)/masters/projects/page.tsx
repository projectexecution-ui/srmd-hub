import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadProjectMaster } from '@/lib/revamp/masters'
import { formatDate } from '@/lib/utils'
import { MasterTable, type MasterRow } from '../MasterTable'

export const dynamic = 'force-dynamic'

/** The project registry with its gaps visible. Every project in the hub points
 *  at this one table, but three different screens create into it, each asking
 *  for different fields — which is why so much of it is empty. */
export default async function ProjectsMasterPage() {
  await requirePermission('cost-control', 'view')
  const projects = await loadProjectMaster()

  const missing = (f: (r: typeof projects[number]) => boolean) => projects.filter(f).length
  const gaps = [
    { label: 'No area', n: missing(r => !r.builtUpSft) },
    { label: 'No start date', n: missing(r => !r.startDate) },
    { label: 'No target date', n: missing(r => !r.targetDate) },
    { label: 'No manager', n: missing(r => !r.hasPm) },
  ]

  const miss = { text: 'missing', tone: 'missing' as const }

  const rows: MasterRow[] = projects.map(p => ({
    id: p.id,
    href: `/project/${p.id}`,
    tone: p.filled < 50 ? 'warn' : undefined,
    cells: {
      name: {
        text: p.name,
        tone: 'strong',
        sub: [p.code, p.parent].filter(Boolean).join(' · ') || undefined,
      },
      type: p.projectType ? { text: p.projectType, tone: 'muted' } : miss,
      area: p.builtUpSft
        ? { text: p.builtUpSft.toLocaleString('en-IN'), sub: 'sft' }
        : miss,
      start: p.startDate ? { text: formatDate(p.startDate) } : miss,
      target: p.targetDate ? { text: formatDate(p.targetDate) } : miss,
      filled: {
        text: `${p.filled}%`,
        tone: p.filled >= 80 ? 'good' : p.filled >= 50 ? 'warn' : 'missing',
      },
    },
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        title="Projects"
        subtitle={`${projects.length} live projects. One registry — but three screens create into it.`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {gaps.map(g => (
          <div key={g.label} className={`rounded-lg border px-3 py-2 ${g.n > 0 ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-white'}`}>
            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{g.label}</p>
            <p className={`text-base font-bold tabular-nums mt-0.5 ${g.n > 0 ? 'text-amber-900' : 'text-gray-900'}`}>
              {g.n}
            </p>
            <p className="text-[11px] text-gray-400">of {projects.length}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-sm font-semibold text-amber-900">Why so much is empty</p>
        <p className="text-xs text-amber-800 mt-1">
          A project can be created from three different forms — the hub&apos;s own New Project, Cost
          Control&apos;s wizard, and JMR admin — and each asks for a different set of fields. Without
          area, no ₹/sft can be shown anywhere. Without dates, nothing can say whether a project is late.
        </p>
      </div>

      <MasterTable
        columns={[
          { key: 'name', label: 'Project' },
          { key: 'type', label: 'Type', width: 'w-28' },
          { key: 'area', label: 'Area', align: 'right', width: 'w-28' },
          { key: 'start', label: 'Start', width: 'w-28' },
          { key: 'target', label: 'Target', width: 'w-28' },
          { key: 'filled', label: 'Filled', align: 'right', width: 'w-24' },
        ]}
        sortableKeys={['name', 'area', 'filled']}
        rows={rows}
        searchPlaceholder="Search a project by name or code…"
        emptyMessage="No live projects."
      />
    </div>
  )
}
