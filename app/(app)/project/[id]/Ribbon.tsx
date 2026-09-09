'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  BarChart3, CircleCheck, Layers, CreditCard, ClipboardList, GitBranch, Package,
  Ruler, ShieldCheck, CalendarDays, FileText, FileBarChart, Users, MessageSquare,
  Briefcase, Settings2, type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  activeWorkspaceSlug, activeSubTab, workspaceHref, ribbonFor, findWorkspaceTab,
  type WorkspaceTab,
} from '@/lib/revamp/workspace'

const ICONS: Record<string, LucideIcon> = {
  BarChart3, CircleCheck, Layers, CreditCard, ClipboardList, GitBranch, Package,
  Ruler, ShieldCheck, CalendarDays, FileText, FileBarChart, Users, MessageSquare,
  Briefcase, Settings2,
}

/**
 * The fifteen-tab ribbon (§1).
 *
 * All fifteen are in view: icon over an 11px label, five groups separated by a
 * hairline with the group name beneath. Below 1180px the labels and group
 * captions drop and the icons stay, which is what keeps fifteen tabs on a
 * laptop without an overflow menu. Only on a phone does it scroll, and then in
 * its OWN container — AGENTS.md: `main` sets overflow-x-auto, so anything that
 * leans on it for scrolling also silently kills page-level `sticky`.
 *
 * The 1180px threshold is MEASURED, not guessed (AGENTS.md asks for this):
 * all fifteen labelled tabs come to 860px, and with the 240px sidebar plus 48px
 * of page padding that needs a 1148px viewport — so they fit at 1180 with room
 * to spare. Icons alone are 509px, which fits any tablet. The per-tab
 * `min-width:62px` the mock uses is the thing that does NOT fit: it pushes the
 * ribbon to 1285px and demands a 1573px screen.
 *
 * `tabs` arrives already filtered to what this person may open. Permissions are
 * a server concern; this component only draws.
 */
export function Ribbon({
  projectId, tabs, pills, canSetup, badges = {}, badgeTitles = {},
}: {
  projectId: string
  tabs: WorkspaceTab[]
  /** tab slug → the pill indices this person may open. A tab absent here shows all its pills. */
  pills?: Record<string, number[]>
  /** tab slug → a count to show on that tab, in amber. Used for approvals
   *  waiting on THIS person; general so another lane can carry one later. */
  badges?: Record<string, number>
  /** Words for a badge's tooltip; "n waiting on you" when absent. */
  badgeTitles?: Record<string, string>
  canSetup: boolean
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const activeSlug = activeWorkspaceSlug(pathname, projectId)
  const groups = ribbonFor(tabs)
  const current = findWorkspaceTab(activeSlug)
  const activeSub = current ? activeSubTab(current, params.get('view') ?? undefined) : 0

  return (
    <>
      <div
        className="flex items-stretch border-b border-gray-200 overflow-x-auto sm:overflow-x-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Project sections"
      >
        {groups.map((g, gi) => (
          <div
            key={g.id}
            className={cn(
              'flex flex-col min-w-0 px-1.5',
              gi > 0 && 'border-l border-gray-200',
            )}
          >
            <div className="flex gap-px">
              {g.tabs.map(tab => {
                const Icon = ICONS[tab.icon] ?? BarChart3
                const isActive = tab.slug === activeSlug
                return (
                  <Link
                    key={tab.slug || 'index'}
                    href={workspaceHref(projectId, tab)}
                    title={tab.built ? tab.label : `${tab.label} — coming soon`}
                    role="tab"
                    aria-selected={isActive}
                    className={cn(
                      'flex flex-col items-center justify-start gap-1 rounded-lg px-[5px] py-2 min-h-[44px]',
                      'transition-colors flex-shrink-0',
                      isActive
                        ? 'bg-indigo-50 text-indigo-700'
                        : tab.built
                          ? 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                          // Greyed, still a link: the panel behind it says what
                          // the lane will hold, so it is never a dead end.
                          : 'text-gray-400 hover:bg-gray-50 hover:text-gray-600',
                    )}
                  >
                    <span className="relative flex-shrink-0">
                      <Icon className="h-[17px] w-[17px]" strokeWidth={1.6} />
                      {/* The yellow count, pinned to the icon so it reads at
                          both ribbon widths — the label is hidden under
                          1180px and a badge beside it would vanish with it. */}
                      {(badges[tab.slug] ?? 0) > 0 && (
                        <span
                          title={badgeTitles[tab.slug] ?? `${badges[tab.slug]} waiting on you`}
                          className="absolute -top-1.5 -right-2 inline-flex items-center justify-center rounded-full bg-amber-100 text-amber-800 border border-amber-300 text-[9px] font-bold tabular-nums min-w-[15px] h-[15px] px-[3px]"
                        >
                          {badges[tab.slug]}
                        </span>
                      )}
                    </span>
                    {/* Labels drop below 1180px; the icons carry the ribbon. */}
                    <span
                      className={cn(
                        'hidden min-[1180px]:block text-[12px] leading-none whitespace-nowrap',
                        isActive && 'font-medium',
                      )}
                    >
                      {tab.ribbon}
                    </span>
                  </Link>
                )
              })}
            </div>
            <div className="hidden min-[1180px]:block text-center text-[12px] tracking-wide text-gray-400 mt-1 mb-1">
              {g.label}
            </div>
          </div>
        ))}

        {/* Setup — not one of the fifteen (it configures the project rather
            than reporting on it), so it sits outside the groups rather than
            being hidden. */}
        {canSetup && (
          <div className="flex flex-col ml-auto pl-2 border-l border-gray-200">
            <div className="flex gap-px">
              <Link
                href={`/project/${projectId}/setup`}
                title="Project setup"
                aria-label="Project setup"
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg px-[5px] py-2 min-h-[44px] transition-colors flex-shrink-0',
                  activeSlug === 'setup'
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-400 hover:bg-gray-50 hover:text-gray-700',
                )}
              >
                <Settings2 className="h-[17px] w-[17px]" strokeWidth={1.6} />
                {/* Named, not just an icon — a gear with no word is the
                    classic hidden control (UX item 33). Hidden where the tab
                    labels hide too, so it never widens the ribbon. */}
                <span className="hidden min-[1180px]:block text-[12px] leading-none">Setup</span>
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Sub-tabs — a pill row, the second and last level. */}
      {current && current.subs.length > 0 && (
        <div
          className="flex gap-1.5 overflow-x-auto py-2 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1"
          role="tablist"
          aria-label={`${current.label} views`}
        >
          {current.subs.map((sub, i) => (pills && pills[current.slug] && !pills[current.slug].includes(i)) ? null : (
            <Link
              key={sub}
              href={workspaceHref(projectId, current, i)}
              role="tab"
              aria-selected={i === activeSub}
              className={cn(
                'rounded-full border px-3 py-1.5 text-[12.5px] whitespace-nowrap flex-shrink-0',
                'min-h-[32px] flex items-center transition-colors',
                i === activeSub
                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-900',
              )}
            >
              {sub}
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
