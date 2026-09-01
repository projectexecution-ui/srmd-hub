'use client'
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
        className="flex gap-1 overflow-x-auto px-2 sm:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(tab => {
          const isActive = tab.slug === active
          return (
            <Link
              key={tab.slug || 'overview'}
              href={tabHref(projectId, tab)}
              title={tab.hint}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'relative whitespace-nowrap px-3 py-3 text-sm transition-colors min-h-[44px] flex items-center gap-1.5',
                isActive
                  ? 'font-semibold text-indigo-800'
                  : tab.built
                    ? 'text-gray-600 hover:text-gray-900'
                    : 'text-gray-400 hover:text-gray-600',
              ].join(' ')}
            >
              {tab.label}
              {!tab.built && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-amber-400"
                  title="Not built yet"
                  aria-label="not built yet"
                />
              )}
              {isActive && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-indigo-700" />
              )}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
