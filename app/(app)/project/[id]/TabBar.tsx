'use client'
import { Fragment } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { tabHref, activeTabSlug, type ProjectTab } from '@/lib/revamp/tabs'

/**
 * The cockpit's tab strip.
 *
 * Scrolls horizontally in its OWN container rather than relying on `main` —
 * see AGENTS.md: `main` has overflow-x-auto, so anything depending on it for
 * scrolling also silently kills page-level `sticky`.
 *
 * Tabs that are not built yet still appear, greyed with a dot, and still
 * navigate — clicking one lands on a panel that says what it will hold. The
 * alternative (hiding them) makes the cockpit look finished when it isn't.
 *
 * `tabs` is already filtered to what this person may open (see visibleTabs) —
 * a tab they cannot open is not shown at all, rather than shown and then
 * refused. The layout does that filtering, because permissions are a server
 * concern and this component runs in the browser.
 */
export function TabBar({ projectId, tabs }: { projectId: string; tabs: ProjectTab[] }) {
  const pathname = usePathname()
  const active = activeTabSlug(pathname, projectId)

  return (
    <div className="border-b border-gray-200 bg-white">
      <nav
        aria-label="Project sections"
        className="flex items-center gap-1 overflow-x-auto px-2 sm:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab, i) => {
          // A divider before the first unbuilt tab, so the strip reads as
          // "here is the project" then "here is what is still coming" rather
          // than one list where some entries quietly do nothing.
          const firstComingSoon = !tab.built && (i === 0 || tabs[i - 1].built)
          const isActive = tab.slug === active
          return (
            <Fragment key={tab.slug || 'index'}>
              {firstComingSoon && (
                <span
                  className="flex items-center gap-2 pl-2 pr-1 flex-shrink-0"
                  aria-hidden
                >
                  <span className="h-4 w-px bg-gray-200" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">
                    Coming soon
                  </span>
                </span>
              )}

              <Link
                href={tabHref(projectId, tab)}
                title={tab.built ? tab.hint : `Coming soon — ${tab.hint}`}
                aria-current={isActive ? 'page' : undefined}
                aria-label={tab.built ? undefined : `${tab.label} — coming soon`}
                className={[
                  'relative whitespace-nowrap px-3 py-3 text-sm transition-colors min-h-[44px] flex items-center gap-1.5 flex-shrink-0',
                  isActive
                    ? 'font-semibold text-indigo-800'
                    : tab.built
                      ? 'text-gray-600 hover:text-gray-900'
                      // Light grey — Aksha's ask. Still a link, because the
                      // panel behind it says what the lane will hold and where
                      // that work happens today.
                      : 'text-gray-400 font-normal hover:text-gray-600',
                ].join(' ')}
              >
                {tab.label}
                {isActive && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-indigo-700" />
                )}
              </Link>
            </Fragment>
          )
        })}
      </nav>
    </div>
  )
}
