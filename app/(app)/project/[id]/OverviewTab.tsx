import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatINR } from '@/lib/utils'
import { loadCockpit } from '@/lib/revamp/project-cockpit'
import { PROJECT_TABS, tabHref, builtCount } from '@/lib/revamp/tabs'
import { ArrowRight, AlertTriangle } from 'lucide-react'

/** The project's money in the Internal Estimate's own colours, then a plain
 *  list of what the project holds. A summary on purpose — the full
 *  seven-column table is the Budget tab, which is where a project opens. */
export async function OverviewTab({ projectId }: { projectId: string }) {
  const data = await loadCockpit(projectId)
  if (!data) notFound()

  const { project, money, categories, subSkills } = data
  const sft = project.builtUpSft ?? 0
  const { built, total } = builtCount()

  const figures = [
    { label: 'Internal Estimate', value: money.internalEstimate, tone: 'text-indigo-800' },
    { label: 'Awaiting Approval', value: money.awaitingApproval, tone: 'text-amber-700' },
    { label: 'Budget (ERP)',      value: money.budgetErp,        tone: 'text-gray-900' },
    { label: 'WO / PO',           value: money.wo,               tone: 'text-gray-600' },
    { label: 'Paid',              value: money.paid,             tone: 'text-gray-600' },
  ]

  const usedTone =
    money.usedPct === null ? 'text-gray-400'
    : money.usedPct > 100 ? 'text-rose-700'
    : money.usedPct > 95 ? 'text-red-600'
    : money.usedPct > 80 ? 'text-amber-700'
    : 'text-emerald-700'

  return (
    <div className="space-y-5">
      {(project.setupPct < 100 || sft === 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-amber-900 flex items-start gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              {sft === 0
                ? 'No built-up area set, so no ₹/sft figure can be shown anywhere for this project.'
                : `Setup is ${project.setupPct}% complete.`}
            </span>
          </p>
          <Link
            href={`/cost-control/projects/${projectId}/setup`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-800 min-h-[44px] sm:min-h-0"
          >
            Finish setup <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <header className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
          <h2 className="text-sm font-bold text-gray-900">Money</h2>
          <Link href={tabHref(projectId, PROJECT_TABS[0])} className="text-xs font-medium text-indigo-700 hover:underline">
            Open the full table →
          </Link>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 divide-x divide-y xl:divide-y-0 divide-gray-100">
          {figures.map(f => {
            const per = sft > 0 && f.value > 0 ? Math.round(f.value / sft) : null
            return (
              <div key={f.label} className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{f.label}</p>
                <p className={`text-base font-bold tabular-nums mt-0.5 ${f.tone}`}>
                  {f.value > 0 ? formatINR(f.value) : '—'}
                </p>
                {per !== null && (
                  <p className="text-[11px] text-gray-400 tabular-nums">₹{per.toLocaleString('en-IN')}/sft</p>
                )}
              </div>
            )
          })}
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">% Used</p>
            <p className={`text-base font-bold tabular-nums mt-0.5 ${usedTone}`}>
              {money.usedPct === null ? '—' : `${money.usedPct}%`}
            </p>
            <p className="text-[11px] text-gray-400">Paid ÷ Budget (ERP)</p>
          </div>
        </div>

        <p className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-500">
          {categories} work categories · {subSkills} sub-skills
        </p>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-2 mb-2 flex-wrap">
          <h2 className="text-sm font-bold text-gray-900">Everything for this project</h2>
          <p className="text-[11px] text-gray-500">
            {built} of {total} sections built · the rest are marked
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 mx-1 align-middle" />
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {PROJECT_TABS.filter(t => t.slug !== 'overview').map(tab => (
            <Link
              key={tab.slug || 'budget'}
              href={tabHref(projectId, tab)}
              className={[
                'rounded-lg border p-3 transition-colors min-h-[44px] block',
                tab.built
                  ? 'border-gray-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30'
                  : 'border-dashed border-gray-200 bg-gray-50/60 hover:bg-gray-50',
              ].join(' ')}
            >
              <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                {tab.label}
                {!tab.built && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{tab.hint}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
