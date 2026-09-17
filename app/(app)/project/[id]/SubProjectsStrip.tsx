import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { usedTone } from '@/lib/revamp/used-tone'
import { loadGroupBudget } from '@/lib/revamp/group-budget'

/**
 * One line above a parent project's OWN Internal Estimate: it has
 * sub-projects, here is what they add up to, open to see them.
 *
 * For Admin Block, CV4, Ekant Kutir, WCE, CMCW and NRH — projects with money
 * of their own that also hold a Common-Expenses (or Design) child. They used
 * to open on the children's roll-up, which hid the parent's own budget
 * (Admin Block: ₹1.43 Cr behind ₹33.7 L). Now they open on their own table,
 * and this strip keeps the children one click away.
 *
 * Collapsed by default (Aksha: declutter, expand on demand) and a <details>,
 * so it needs no client code. The figures are the same roll-up the group
 * page shows — loadGroupBudget — never a second sum. Internal Estimate is
 * deliberately absent: the strip shows to everyone who can open the project
 * and the estimate is reviewer-only.
 */
export async function SubProjectsStrip({ projectId }: { projectId: string }) {
  const { children, total } = await loadGroupBudget(projectId)
  if (children.length === 0) return null
  const n = children.length

  return (
    <details className="group rounded-xl border border-indigo-100 bg-indigo-50/40 open:bg-white">
      <summary className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] cursor-pointer select-none list-none text-sm [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-indigo-400 transition-transform group-open:rotate-90" />
        <span className="font-semibold text-gray-900 whitespace-nowrap">Includes {n} sub-project{n === 1 ? '' : 's'}</span>
        <span className="text-gray-500 truncate">
          · {total.budgetErp > 0 ? formatINR(total.budgetErp) : '—'} budget across them
          {total.paid > 0 && <> · {formatINR(total.paid)} paid</>}
        </span>
        <span className="ml-auto text-[12px] font-medium text-indigo-700 whitespace-nowrap group-open:hidden">Show</span>
        <span className="ml-auto text-[12px] font-medium text-indigo-700 whitespace-nowrap hidden group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-indigo-100 divide-y divide-gray-100">
        {children.map(c => (
          <Link key={c.id} href={`/project/${c.id}`} className="flex items-center gap-3 px-4 py-2 min-h-[44px] text-sm hover:bg-indigo-50/40">
            {c.chip && (
              <span className="inline-flex rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold px-1.5 py-0.5 flex-shrink-0" title={c.code && c.code !== c.chip ? `Code ${c.code}` : undefined}>{c.chip}</span>
            )}
            <span className="font-medium text-gray-900 truncate">{c.name}</span>
            <span className="ml-auto tabular-nums text-gray-700 whitespace-nowrap">{c.money.budgetErp > 0 ? formatINR(c.money.budgetErp) : <span className="text-gray-300">—</span>}</span>
            <span className={`tabular-nums font-semibold w-12 text-right ${usedTone(c.money.usedPct)}`}>{c.money.usedPct != null ? `${c.money.usedPct}%` : '—'}</span>
            <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
          </Link>
        ))}
        {/* Not cosmetic: a reader who sees a total here and a total below will
            add them. They must not — the table is this project's own money. */}
        <p className="px-4 py-2 text-[12px] text-gray-500">
          Sub-projects only. The table below is this project’s own budget; the two are not added together.
        </p>
      </div>
    </details>
  )
}
