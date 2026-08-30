import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadProjectMaster } from '@/lib/revamp/masters'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

/** The project registry with its gaps visible. Every project in the hub points
 *  at this one table, but three different screens create into it, each asking
 *  for different fields — which is why so much of it is empty. */
export default async function ProjectsMasterPage() {
  await requirePermission('cost-control', 'view')
  const rows = await loadProjectMaster()

  const missing = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).length
  const gaps = [
    { label: 'No area', n: missing(r => !r.builtUpSft) },
    { label: 'No start date', n: missing(r => !r.startDate) },
    { label: 'No target date', n: missing(r => !r.targetDate) },
    { label: 'No manager', n: missing(r => !r.hasPm) },
  ]

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Projects"
        back="/masters"
        subtitle={`${rows.length} live projects. One registry — but three screens create into it.`}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {gaps.map(g => (
          <div key={g.label} className={`rounded-lg border px-3 py-2 ${g.n > 0 ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-white'}`}>
            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{g.label}</p>
            <p className={`text-base font-bold tabular-nums mt-0.5 ${g.n > 0 ? 'text-amber-900' : 'text-gray-900'}`}>
              {g.n}
            </p>
            <p className="text-[11px] text-gray-400">of {rows.length}</p>
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

      {/* Desktop */}
      <div className="hidden md:block rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-auto max-h-[65vh]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[240px]">Project</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 w-28">Type</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-28">Area</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 w-28">Start</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 w-28">Target</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-24">Filled</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/60">
                  <td className="px-3 py-2">
                    <Link href={`/project/${r.id}`} className="text-gray-900 hover:underline">
                      {r.code && <span className="font-mono text-[11px] font-bold text-indigo-700 mr-2">{r.code}</span>}
                      {r.parent && <span className="text-gray-400">{r.parent} › </span>}
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-[12px]">{r.projectType ?? '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.builtUpSft ? r.builtUpSft.toLocaleString('en-IN') : <Missing />}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.startDate ? formatDate(r.startDate) : <Missing />}</td>
                  <td className="px-3 py-2 text-gray-600">{r.targetDate ? formatDate(r.targetDate) : <Missing />}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${
                    r.filled >= 80 ? 'text-emerald-700' : r.filled >= 50 ? 'text-amber-700' : 'text-rose-700'
                  }`}>{r.filled}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
        {rows.map(r => (
          <Link key={r.id} href={`/project/${r.id}`} className="block px-4 py-3">
            <p className="text-sm text-gray-900">
              {r.code && <span className="font-mono text-[11px] font-bold text-indigo-700 mr-1.5">{r.code}</span>}
              {r.name}
            </p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {r.builtUpSft ? `${r.builtUpSft.toLocaleString('en-IN')} sft` : 'no area'} ·{' '}
              {r.startDate ? formatDate(r.startDate) : 'no start'} ·{' '}
              <span className={r.filled >= 80 ? 'text-emerald-700' : 'text-amber-700'}>{r.filled}% filled</span>
            </p>
          </Link>
        ))}
      </div>
    </div>
  )
}

function Missing() {
  return <span className="text-rose-300">—</span>
}
