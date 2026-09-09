import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, getDisabledModuleSlugs } from '@/lib/auth'
import { ChevronLeft, Bell } from 'lucide-react'
import { loadWorkspaceHeader } from '@/lib/revamp/workspace-header'
import { SETUP_TAB } from '@/lib/revamp/workspace'
import { visibleWorkspaceTabsV2, allowedSubsByTab, canOpenWorkspaceTab } from '@/lib/revamp/permissions'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { formatDateTime } from '@/lib/utils'
import { Ribbon } from './Ribbon'
import { getMyApprovalCounts } from '@/lib/revamp/approval-counts'

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
  const [disabled, isReviewer, approvalCounts] = await Promise.all([
    getDisabledModuleSlugs(),
    checkIsCcReviewer(),
    // Deduplicated with the sidebar's call by React cache — one RPC per page.
    getMyApprovalCounts(),
  ])
  const { id } = await params
  const res = await loadWorkspaceHeader(id)
  // A project that is not there is a 404. A lookup that BROKE is not — saying
  // "not found" would tell someone their project had gone, which is both wrong
  // and alarming, so the failure states itself instead.
  if (res.kind === 'missing') notFound()
  if (res.kind === 'failed') {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-semibold text-rose-900">This project could not be opened</p>
          <p className="text-xs text-rose-800 mt-1">
            The project record could not be read, so the workspace has nothing to build a header from.
            The project itself is fine — this is a read that failed.
          </p>
          <p className="text-xs text-rose-800 mt-2 font-mono break-all">{res.error}</p>
          <Link href="/cost-control" className="inline-flex mt-3 text-xs font-semibold text-rose-900 underline">
            Back to all projects
          </Link>
        </div>
      </div>
    )
  }
  const head = res.header

  // Each tab and each pill under it has a switch of its own in the matrix,
  // inheriting the module until set — so with no switches set this is the
  // ribbon exactly as before (lib/revamp/permissions.ts).
  const tabs = visibleWorkspaceTabsV2(perms, disabled, isReviewer)
  const pills = allowedSubsByTab(perms, tabs)
  const canSetup = canOpenWorkspaceTab(perms, SETUP_TAB, disabled, isReviewer)

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
              <span className="inline-flex rounded bg-indigo-50 text-indigo-700 text-[12px] font-bold px-1.5 py-0.5 flex-shrink-0">
                {head.code}
              </span>
            )}

            <h1 className="text-[20px] font-semibold text-gray-900 tracking-[-0.01em] truncate min-w-0">
              {head.name}
            </h1>

            {/* Grey meta, hairline-separated. A chip whose value IN4 does not
                hold is left out rather than shown as "—": the header is
                identity, and a blank identity field is noise. */}
            {/* The Internal Estimate page printed this chip; it no longer does
                when it renders inside the Budget tab, so the status moved up
                here rather than being lost. */}
            {head.ccStatus && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-bold tracking-wide flex-shrink-0 ${
                head.ccStatus === 'active' ? 'bg-green-100 text-green-800'
                : head.ccStatus === 'on_hold' ? 'bg-amber-100 text-amber-800'
                : head.ccStatus === 'completed' ? 'bg-blue-100 text-blue-800'
                : 'bg-gray-100 text-gray-700'
              }`}>
                {head.ccStatus.replace('_', ' ').toUpperCase()}
              </span>
            )}

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
                <span className="hidden sm:inline text-[12px] text-gray-400 whitespace-nowrap">
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
                  <span className="inline-flex items-center justify-center rounded-full bg-indigo-600 text-white text-[12px] font-bold min-w-[18px] h-[18px] px-1 tabular-nums">
                    {head.unread}
                  </span>
                )}
              </Link>
            </div>
          </div>

          <Ribbon
            projectId={id}
            tabs={tabs}
            pills={pills}
            canSetup={canSetup}
            /* This project's own Cost Control queue, for the Approvals tab. */
            badges={{ approvals: approvalCounts.byProject[id] ?? 0 }}
          />
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
