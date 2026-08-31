import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadMasterSummaries } from '@/lib/revamp/masters'
import { ArrowRight, Layers } from 'lucide-react'

export const dynamic = 'force-dynamic'

/** Masters landing. Its first job is to make the scattering VISIBLE — you
 *  cannot merge lists nobody can see. Nothing here writes; merging is Aksha's
 *  decision to make with the counts in front of him. */
export default async function MastersPage() {
  await requirePermission('cost-control', 'view')
  const masters = await loadMasterSummaries()
  const scattered = masters.filter(m => m.sources.length > 1)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Masters"
        subtitle="The lists everything else points at. Today several of them exist more than once — this is where that gets fixed."
      />

      {scattered.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
            <Layers className="h-4 w-4" />
            {scattered.length} of these live in more than one place today
          </p>
          <p className="text-xs text-amber-800 mt-1">
            That is the &ldquo;it&apos;s all scattered&rdquo; problem, measured. Each card below shows
            exactly which lists hold the same thing.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {masters.map(m => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    {m.label}
                    {!m.built && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="not built yet" />}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{m.hint}</p>
                </div>
                {m.total !== null && (
                  <p className="text-lg font-bold tabular-nums text-gray-900 flex-shrink-0">
                    {m.total.toLocaleString('en-IN')}
                  </p>
                )}
              </div>

              <ul className="mt-2.5 space-y-1">
                {m.sources.map(s => (
                  <li key={s.name} className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className={m.sources.length > 1 ? 'text-amber-800' : 'text-gray-500'}>
                      {s.name}
                      {s.note && <span className="text-gray-400"> — {s.note}</span>}
                    </span>
                    {s.count > 0 && <span className="tabular-nums text-gray-600 flex-shrink-0">{s.count.toLocaleString('en-IN')}</span>}
                  </li>
                ))}
              </ul>

              {m.sources.length > 1 && (
                <p className="mt-2 text-[11px] font-medium text-amber-800">
                  ⚠ {m.sources.length} separate lists
                </p>
              )}
            </>
          )

          return m.href ? (
            <Link
              key={m.key}
              href={m.href}
              className="rounded-xl border border-gray-200 bg-white p-4 hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors block"
            >
              {body}
              <p className="mt-3 text-xs font-medium text-indigo-700 inline-flex items-center gap-1">
                Open <ArrowRight className="h-3.5 w-3.5" />
              </p>
            </Link>
          ) : (
            <div key={m.key} className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4">
              {body}
              <p className="mt-3 text-xs text-gray-400">Not built yet</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
