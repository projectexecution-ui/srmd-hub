import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission, getDisabledModuleSlugs } from '@/lib/auth'
import { ChevronLeft } from 'lucide-react'
import { loadCockpit } from '@/lib/revamp/project-cockpit'
import { visibleTabs } from '@/lib/revamp/tabs'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { TabBar } from './TabBar'

export const dynamic = 'force-dynamic'

/**
 * The project cockpit shell: one header and one tab strip, shared by every
 * tab. This is the revamp's central idea — you open a PROJECT, and Budget /
 * Reports / Indent → PO live inside it, instead of opening a module and
 * filtering down to the project you meant.
 *
 * Entering the cockpit needs cost-control view, because every project in the
 * hub is a Cost Control project. Each TAB is then gated on its own module's
 * permission, so nesting a screen inside a project never grants access that
 * the same screen refuses at the top level.
 */
export default async function ProjectCockpitLayout({
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
  const tabs = visibleTabs(perms, disabled, isReviewer)
  const { id } = await params
  const data = await loadCockpit(id)
  if (!data) notFound()

  const { project, money } = data
  const sft = project.builtUpSft ?? 0
  const perSft = sft > 0 && money.budgetErp > 0 ? Math.round(money.budgetErp / sft) : null

  return (
    <div className="min-h-full bg-gray-50/60">
      {/* Header — one line. Identity only: which project you are on, and the
          area every ₹/sft on the page depends on. The money lives on Budget,
          the tab a project opens on, so repeating it here only cost space. */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <Link
            href="/cost-control"
            title="All projects"
            className="text-gray-400 hover:text-gray-700 flex-shrink-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>

          {project.code && (
            <span className="inline-flex rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold px-1.5 py-0.5 flex-shrink-0">
              {project.code}
            </span>
          )}

          <h1 className="font-bold text-gray-900 truncate">
            {project.parentName && (
              <span className="font-medium text-gray-400">{project.parentName} › </span>
            )}
            {project.name}
          </h1>

          <span className="text-xs text-gray-400 flex items-center gap-x-2 min-w-0">
            {sft > 0
              ? <span className="tabular-nums">{sft.toLocaleString('en-IN')} sft</span>
              : <span className="text-amber-600">no area set</span>}
            {perSft && <span className="tabular-nums">· ₹{perSft.toLocaleString('en-IN')}/sft</span>}
          </span>
        </div>

        <div className="max-w-7xl mx-auto">
          <TabBar projectId={id} tabs={tabs} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-5">
        {children}
      </div>
    </div>
  )
}

