import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requirePermission } from '@/lib/auth'
import { ChevronLeft } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { loadCockpit } from '@/lib/revamp/project-cockpit'
import { TabBar } from './TabBar'

export const dynamic = 'force-dynamic'

/**
 * The project cockpit shell: one header and one tab strip, shared by every
 * tab. This is the revamp's central idea — you open a PROJECT, and Budget /
 * Approvals / Reports / Schedule live inside it, instead of opening a module
 * and filtering down to the project you meant.
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
      {/* Header — identity and the two figures worth seeing on every tab. */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 md:px-6 pt-4 pb-3">
          <Link
            href="/cost-control"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 mb-1.5"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            All projects
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
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

            {/* Deliberately only two figures. The full seven-column picture is
                one click away on Budget; a header crowded with money makes
                every tab feel like a finance screen. */}
            <div className="flex items-stretch gap-2 flex-shrink-0">
              <HeaderStat
                label="Waiting on someone"
                value={money.awaitingApproval > 0 ? formatINR(money.awaitingApproval) : '—'}
                sub={money.awaitingCount > 0 ? `${money.awaitingCount} request${money.awaitingCount === 1 ? '' : 's'}` : 'nothing pending'}
                tone={money.awaitingApproval > 0 ? 'amber' : 'plain'}
              />
              <HeaderStat
                label="Budget (ERP)"
                value={money.budgetErp > 0 ? formatINR(money.budgetErp) : '—'}
                sub={money.usedPct !== null ? `${money.usedPct}% paid` : 'no budget yet'}
                tone="plain"
              />
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

function HeaderStat({
  label, value, sub, tone,
}: { label: string; value: string; sub: string; tone: 'amber' | 'plain' }) {
  return (
    <div
      className={[
        'rounded-lg border px-3 py-2 min-w-[8.5rem]',
        tone === 'amber' ? 'border-amber-200 bg-amber-50/70' : 'border-gray-200 bg-gray-50/70',
      ].join(' ')}
    >
      <p className={`text-[10px] uppercase tracking-wide font-semibold ${tone === 'amber' ? 'text-amber-700' : 'text-gray-500'}`}>
        {label}
      </p>
      <p className={`text-base font-bold tabular-nums mt-0.5 ${tone === 'amber' ? 'text-amber-900' : 'text-gray-900'}`}>
        {value}
      </p>
      <p className="text-[11px] text-gray-500">{sub}</p>
    </div>
  )
}
