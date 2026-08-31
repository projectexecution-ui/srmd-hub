import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth'
import { ChevronLeft } from 'lucide-react'
import { loadCockpit } from '@/lib/revamp/project-cockpit'
import { TabBar } from './TabBar'

export const dynamic = 'force-dynamic'

/**
 * The project cockpit shell: one header and one tab strip, shared by every
 * tab. This is the revamp's central idea — you open a PROJECT, and Budget /
 * Reports / Indent → PO live inside it, instead of opening a module and
 * filtering down to the project you meant.
 *
 * Gated on cost-control view for now because every project in the hub is a
 * Cost Control project; per-tab permissions come with the matrix work.
 */
export default async function ProjectCockpitLayout({
  children, params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  await requirePermission('cost-control', 'view')
  const { id } = await params
  const data = await loadCockpit(id)
  if (!data) notFound()

  const { project, money } = data
  const sft = project.builtUpSft ?? 0
  const perSft = sft > 0 && money.budgetErp > 0 ? Math.round(money.budgetErp / sft) : null

  return (
    <div className="min-h-full bg-gray-50/60">
      {/* Header — identity only. The money lives on Budget, which is the tab
          a project opens on, so repeating it here only cost vertical space. */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 md:px-6 pt-4 pb-3">
          <Link
            href="/cost-control"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1.5"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            All projects
          </Link>

          <div className="min-w-0">
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-gray-900 break-words">
                {project.parentName && (
                  <span className="text-gray-400 font-semibold">{project.parentName} › </span>
                )}
                {project.name}
              </h1>
              <p className="text-sm text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                {project.code && (
                  <span className="inline-flex rounded bg-indigo-50 text-indigo-700 text-[11px] font-bold px-1.5 py-0.5">
                    {project.code}
                  </span>
                )}
                {sft > 0
                  ? <span className="tabular-nums">{sft.toLocaleString('en-IN')} sft</span>
                  : <span className="text-amber-600">Area not set — ₹/sft cannot show</span>}
                {perSft && <span className="tabular-nums text-gray-400">· ₹{perSft.toLocaleString('en-IN')}/sft budget</span>}
              </p>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto">
          <TabBar projectId={id} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-6 py-5">
        {children}
      </div>
    </div>
  )
}

