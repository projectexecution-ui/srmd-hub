'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatNumber } from '@/lib/utils'
import { storeTabHref, STORE_TAB_LABEL, type StoreTab } from '@/lib/stores/core'

/**
 * One row, scrollable on a phone rather than wrapping into three lines.
 *
 * WHICH tabs is decided in lib/stores/core.ts (roleStoreTabs) and handed in —
 * a guard gets one, a storekeeper three, the people who run it all six.
 * Deciding it here would put the rule in a component nobody can test.
 *
 * Each tab carries what is waiting behind it. Aksha's V1 rule: the count is
 * the point of the tab. A tab with nothing waiting shows no number at all —
 * a row of zeros is the "over-informative" chrome he asked me to take out.
 *
 * Returnables are switched off (RETURNABLES_ON in core.ts). The page still
 * exists and explains itself; it just does not sit in the row.
 */
export function StoresNav({
  tabs, counts = {},
}: {
  tabs: readonly StoreTab[]
  /** How many things are waiting on somebody behind each tab. */
  counts?: Partial<Record<StoreTab, number>>
}) {
  const path = usePathname()
  if (tabs.length <= 1) return null

  return (
    <nav className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="flex gap-1.5 border-b border-gray-200 min-w-max">
        {tabs.map(t => {
          const href = storeTabHref(t)
          // Longest match wins, so /stores/gate does not also light Overview.
          const active = t === 'overview' ? path === '/stores' : path.startsWith(href)
          const n = counts[t] ?? 0
          return (
            <Link
              key={t} href={href}
              aria-current={active ? 'page' : undefined}
              className={`px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap min-h-[44px] flex items-center gap-1.5 border-b-2 -mb-px ${
                active
                  ? 'border-indigo-700 text-indigo-800'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {STORE_TAB_LABEL[t]}
              {n > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-900 tabular-nums">
                  {formatNumber(n, 0)}
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
