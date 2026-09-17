import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMyProfile } from '@/lib/auth'
import { Warehouse } from 'lucide-react'
import { StoresNav } from './StoresNav'
import { canSeeStores, visibleStoreTabs } from '@/lib/stores/core'
import { loadCounts } from '@/lib/stores/queries'
import { crossProjectOn } from '@/lib/stores/settings'

export const dynamic = 'force-dynamic'

/**
 * Material In & Out — the org-level section.
 *
 * Who may open it is canSeeStores in lib/stores/core.ts — admin only until
 * STORES_LIVE, which is off (Aksha, 13 Sep 2026: "for now keep it visible for
 * me only Admin", and 15 Sep: "i am not making it LIVE as of now").
 *
 * The gate is here rather than on each page so a new screen cannot be added
 * and forget it, and it is a real refusal — hiding the lane in the sidebar
 * would leave the section one typed URL wide.
 */
export default async function StoresLayout({ children }: { children: React.ReactNode }) {
  const profile = await getMyProfile()
  if (!canSeeStores(profile?.role)) notFound()

  // The tabs carry what is waiting behind them, so "is anything on me?" is
  // answered from whichever screen you happen to be standing on.
  // "To come back" only exists while borrowing between projects is on.
  const borrowing = await crossProjectOn()
  const tabs = visibleStoreTabs(profile?.role, { borrowing })
  const counts = await loadCounts()

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 border border-indigo-100">
            <Warehouse className="h-4.5 w-4.5 text-indigo-700" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-tight">Material In &amp; Out</h1>
            <p className="text-[12px] text-gray-500">The main gate, the store, and what it holds</p>
          </div>
          <span className="ml-auto rounded-full bg-amber-100 px-2.5 py-1 text-[10.5px] font-bold text-amber-900">
            Under review · admin only
          </span>
        </div>
        <p className="text-[12.5px] text-gray-600 max-w-3xl">
          Built from the <b>Site Material In-Out Process</b> mind map. Live on{' '}
          <Link href="/project/551a8314-84f7-426a-a0d5-20590830c62e/material" className="text-indigo-700 font-semibold hover:underline">NGH B</Link>{' '}
          only for now, so the shape can be picked apart before it goes everywhere.
        </p>
      </header>

      <StoresNav
        tabs={tabs}
        counts={{
          gate: counts.toComplete,
          requests: counts.pendingRequests,
          issue: counts.toIssue,
          receive: counts.toReceive,
        }}
      />
      {children}
    </div>
  )
}
