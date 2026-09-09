import Link from 'next/link'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadHousekeeping } from '@/lib/revamp/housekeeping'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HATS = [
  { key: 'admin', label: 'For the admin', hint: 'Links and lists that keep the two systems in step' },
  { key: 'accounts', label: 'For accounts', hint: 'Tax ids that will bounce' },
  { key: 'head', label: 'For the Head', hint: 'Things running past their date or their people' },
] as const

/** Every place the masters disagree with themselves, each with where it is
 *  fixed — IN4 or a CT Hub page. Read-only; the fixing happens at the link. */
export default async function HousekeepingPage() {
  await requirePermission('cost-control', 'view')
  const { items, open } = await loadHousekeeping()
  return (
    <div className="space-y-4">
      <PageHeader title="Housekeeping" subtitle={open ? `${open} of ${items.length} checks need someone’s attention.` : 'Every check is clear.'} />
      {HATS.map(h => {
        const mine = items.filter(i => i.hat === h.key)
        if (mine.length === 0) return null
        return (
          <section key={h.key} className="rounded-lg border border-gray-200 bg-white">
            <h2 className="px-3 py-2 border-b border-gray-100 text-[13px] font-semibold text-gray-900">{h.label} <span className="font-normal text-gray-500 text-[12px]">— {h.hint}</span></h2>
            <ul className="divide-y divide-gray-100">
              {mine.sort((a, b) => b.count - a.count).map(i => (
                <li key={i.key}>
                  <Link href={i.href} className="flex items-start gap-3 px-3 py-2 min-h-[44px] hover:bg-indigo-50/40">
                    <span className={`w-12 flex-shrink-0 text-right text-[15px] font-semibold tabular-nums ${i.count > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {i.count > 0 ? i.count.toLocaleString('en-IN') : <CheckCircle2 className="inline h-4 w-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-gray-900">{i.what}</span>
                      {i.count > 0 && i.hint && <span className="block text-[12px] text-gray-500 truncate">{i.hint}</span>}
                    </span>
                    <span className={`flex-shrink-0 text-[11px] rounded border px-1.5 py-0.5 ${i.fixIn === 'IN4' ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-indigo-200 bg-indigo-50 text-indigo-800'}`}>fix in {i.fixIn}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-indigo-600 flex-shrink-0 mt-1" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <p className="text-[12px] text-gray-500">A “fix in IN4” item is corrected in IN4 and clears here on the next sync. A “fix in CT Hub” item is corrected on the page the row opens.</p>
    </div>
  )
}
