import Link from 'next/link'
import { ArrowRight, Search } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadMasterSearch } from '@/lib/revamp/masters-in4'
import { In4Note } from '../In4Note'
import { MasterSearchBox } from '../MasterSearchBox'

export const dynamic = 'force-dynamic'

/** One search over all six masters. "Is Pidilite a vendor or a contractor?"
 *  is answered here, and every hit opens its screen with the search typed. */
export default async function MasterSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePermission('cost-control', 'view')
  const { q = '' } = await searchParams
  const r = await loadMasterSearch(q)
  const total = r.groups.reduce((t, g) => t + g.hits.length + g.more, 0)

  return (
    <div className="space-y-4">
      <PageHeader title="Search the masters" subtitle="Trusts, projects, contacts, categories, items and BOQ names — in one go." />
      <MasterSearchBox initial={q} autoFocus />
      <In4Note in4={r.in4} error={r.in4Error} what="BOQ names" />

      {q.trim() === '' ? null : total === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-500">
          Nothing in any master matches “{q}”. Try a shorter word, a code, a GST number or a phone number.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-[12px] text-gray-500">{total.toLocaleString('en-IN')} match{total === 1 ? '' : 'es'} for “{q}”</p>
          {r.groups.map(g => (
            <section key={g.master} className="rounded-lg border border-gray-200 bg-white">
              <h2 className="px-3 py-2 text-[12px] uppercase tracking-wide text-gray-500 border-b border-gray-100 flex items-center gap-2">
                <Search className="h-3 w-3" /> {g.master} <span className="ml-auto tabular-nums">{g.hits.length + g.more}</span>
              </h2>
              <ul className="divide-y divide-gray-100">
                {g.hits.map((h, i) => (
                  <li key={i}>
                    <Link href={h.href} className="flex items-center gap-3 px-3 py-2 min-h-[44px] hover:bg-indigo-50/40">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-gray-900">{h.label}</span>
                        {h.sub && <span className="block text-[12px] text-gray-500">{h.sub}</span>}
                      </span>
                      <ArrowRight className="ml-auto h-3.5 w-3.5 text-indigo-600 flex-shrink-0" />
                    </Link>
                  </li>
                ))}
                {g.more > 0 && (
                  <li className="px-3 py-2 text-[12px] text-gray-500">
                    {g.more} more — <Link href={g.hits[0]?.href ?? '#'} className="text-indigo-700 hover:underline">open {g.master} with this search</Link>
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
