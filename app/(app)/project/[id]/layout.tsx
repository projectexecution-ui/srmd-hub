import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, getDisabledModuleSlugs } from '@/lib/auth'
import { ChevronLeft, Bell } from 'lucide-react'
import { loadWorkspaceHeader } from '@/lib/revamp/workspace-header'
import { visibleWorkspaceTabs } from '@/lib/revamp/workspace'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { formatDateTime } from '@/lib/utils'
import { Ribbon } from './Ribbon'

export const dynamic = 'force-dynamic'

/**
 * The project workspace shell (build order §1) — one header and one ribbon,
 * shared by all fifteen tabs.
 *
 * This is the revamp's central idea: you open a PROJECT, and Budget, WO/PO,
 * JMR and the rest live inside it, instead of opening a module and filtering
 * down to the project you meant.
 *
 * Entering needs cost-control view, because every project in the hub is a Cost
 * Control project. Each TAB is then gated on its own module's permission, so
 * nesting a screen inside a project never grants access the same screen
 * refuses at the top level.
 */
export default async function ProjectWorkspaceLayout({
  children, params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const perms = await requirePermission('cost-control', 'view')
  const [disabled, isReviewer] = await Promise.all([
    getDisabledModuleSlugs(),
    checkIsCcReviewer(),
  ])
  const { id } = await params
  const head = await loadWorkspaceHeader(id)
  if (!head) notFound()

  const tabs = visibleWorkspaceTabs(perms, disabled, isReviewer)

  return (
    <div className="min-h-full bg-gray-50/60">
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6">

          {/* Header — one line, identity only. No action button: the actions
              belong to the tab you are on, not to the project as a whole. */}
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap py-2 min-h-[56px]">
            <Link
              href="/cost-control"
              title="All projects"
              aria-label="All projects"
              className="text-gray-400 hover:text-gray-700 flex-shrink-0 -ml-1"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>

            {head.code && (
              <span className="inline-flex rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold px-1.5 py-0.5 flex-shrink-0">
                {head.code}
              </span>
            )}

            <h1 className="text-[20px] font-semibold text-gray-900 tracking-[-0.01em] truncate min-w-0">
              {head.name}
            </h1>

            {/* Grey meta, hairline-separated. A chip whose value IN4 does not
                hold is left out rather than shown as "—": the header is
                identity, and a blank identity field is noise. */}
            <div className="flex items-center text-[12.5px] text-gray-500 min-w-0">
              <Meta first>Project workspace</Meta>
              {head.parentName && <Meta>Part of <b className="font-medium text-gray-700">{head.parentName}</b></Meta>}
              {head.trustCode && (
                <Meta title={head.trustName ?? undefined}>
                  Trust <b className="font-medium text-gray-700">{head.trustCode}</b>
                </Meta>
              )}
              {head.subProjectCount != null && (
                <Meta><b className="font-medium text-gray-700">{head.subProjectCount}</b> sub-projects</Meta>
              )}
              {head.builtUpSft != null && head.builtUpSft > 0
                ? <Meta><b className="font-medium text-gray-700 tabular-nums">{head.builtUpSft.toLocaleString('en-IN')}</b> sft</Meta>
                // Not cosmetic: with no area every ₹/sft on the Budget tab is
                // unknowable, so say so where the area would have been.
                : <Meta><span className="text-amber-600">no area set</span></Meta>}
            </div>

            <div className="flex items-center gap-2 ml-auto flex-shrink-0">
              {head.syncedAt && (
                <span className="hidden sm:inline text-[11.5px] text-gray-400 whitespace-nowrap">
                  IN4 · {formatDateTime(head.syncedAt)}
                </span>
              )}
              <Link
                href="/notifications"
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12.5px] text-gray-600 hover:bg-gray-50 min-h-[36px]"
              >
                <Bell className="h-4 w-4 text-gray-400" />
                <span className="hidden sm:inline">Notifications</span>
                {head.unread > 0 && (
                  <span className="inline-flex items-center justify-center rounded-full bg-indigo-600 text-white text-[10px] font-bold min-w-[18px] h-[18px] px-1 tabular-nums">
                    {head.unread}
                  </span>
                )}
              </Link>
            </div>
          </div>

          <Ribbon projectId={id} tabs={tabs} canSetup={isReviewer} />
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-5">
        {children}
      </div>
    </div>
  )
}

function Meta({ children, first, title }: { children: React.ReactNode; first?: boolean; title?: string }) {
  return (
    <span
      title={title}
      className={
        first
          ? 'px-0 pr-2.5 whitespace-nowrap'
          : 'px-2.5 border-l border-gray-200 whitespace-nowrap'
      }
    >
      {children}
    </span>
  )
}
