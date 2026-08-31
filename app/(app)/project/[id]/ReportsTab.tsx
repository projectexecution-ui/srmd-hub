import { Fragment } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { formatINR, formatDate } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { TreeProvider, TreeToolbar, CatChevron, CatRows, SubRow } from '@/components/cost-control/project-tree'
import { loadProjectReports, type ReportSide, type BillsSide } from '@/lib/revamp/reports-data'
import { loadCockpit } from '@/lib/revamp/project-cockpit'
import { AlertTriangle } from 'lucide-react'

/**
 * Contractor and Supplier money for one project.
 *
 * Uses the SAME tree machinery as the Internal Estimate page — TreeProvider /
 * CatChevron / CatRows / SubRow — so it collapses, expands and reads exactly
 * like the table Aksha already works in: category rows over party rows, sticky
 * header inside its own scroll box, ₹/sft under every figure, and a matching
 * card list on mobile. Not a second table invented for this screen.
 */
export async function ReportsTab({ projectId }: { projectId: string }) {
  const [{ contractor, supplier, billsPipeline, unattributed, rolledUpChildren }, cockpit] = await Promise.all([
    loadProjectReports(projectId),
    loadCockpit(projectId),
  ])
  if (!cockpit) notFound()

  const sft = cockpit.project.builtUpSft ?? 0
  const nothing = contractor.categories.length === 0 && supplier.categories.length === 0

  return (
    <div className="space-y-4">
      {/* A group's figures include its children. Say so — a total that silently
          covers more than the project you opened is how numbers get misread. */}
      {rolledUpChildren > 0 && !nothing && (
        <p className="text-xs text-gray-600 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2">
          Includes this project&rsquo;s <b>{rolledUpChildren} sub-projects</b>. IN4 uploads name the
          group; CT Hub splits it into its buildings, so the group shows everything underneath it.
        </p>
      )}

      {nothing ? (
        <EmptyState
          title="Nothing attributed to this project yet"
          description="No sub-project in the uploads carries this project's name. That is a naming gap, not missing money — see the note below."
        />
      ) : (
        <>
          <SideTable title="Contractor" side={contractor} partyLabel="Contractor" sft={sft} />
          <SideTable title="Supplier" side={supplier} partyLabel="Supplier" sft={sft} />
        </>
      )}

      <BillsBlock side={billsPipeline} />

      {unattributed.subProjects > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {unattributed.subProjects} sub-projects belong to no project in CT Hub
          </p>
          <p className="text-xs text-amber-800 mt-1">
            {formatINR(unattributed.bill)} of billed work sits in the uploads under names the hub does
            not have. Parked rather than guessed onto a project — it attaches on its own once the
            project exists or the name is confirmed.
          </p>
          <Link href="/masters/mapping" className="inline-block mt-1.5 text-xs font-semibold text-amber-900 underline">
            See exactly which, and why →
          </Link>
        </div>
      )}
    </div>
  )
}

/**
 * Bills sitting with CT for this project, from the daily bills report.
 *
 * Grouped by the report's own "area" — the building — using the same tree as
 * everything else, so a group project shows each of its buildings as a
 * collapsible row. Oldest first inside each: the age is what makes a bill
 * chaseable, and it is the whole reason this list is worth having per project
 * rather than only in the pipeline module.
 */
function BillsBlock({ side }: { side: BillsSide }) {
  if (side.bills.length === 0 && side.unattributed.count === 0) return null

  const byArea = new Map<string, typeof side.bills>()
  for (const b of side.bills) {
    const list = byArea.get(b.area)
    if (list) list.push(b); else byArea.set(b.area, [b])
  }
  const areas = [...byArea.entries()].sort((a, b) =>
    b[1].reduce((s, x) => s + x.amount, 0) - a[1].reduce((s, x) => s + x.amount, 0))

  const overdue = side.bills.filter(b => b.ageDays >= 30).length

  return (
    <TreeProvider allCatIds={areas.map(([a]) => a)} emptyCount={0}>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60 gap-2 flex-wrap">
          <span className="text-sm font-bold text-gray-900">
            Bills with CT
            <span className="ml-2 text-[11px] font-normal text-gray-500">
              {side.bills.length} bill{side.bills.length === 1 ? '' : 's'} · {formatINR(side.total)}
              {overdue > 0 && <span className="text-rose-700 font-semibold"> · {overdue} over 30 days</span>}
            </span>
          </span>
          {areas.length > 0 && <TreeToolbar />}
        </div>

        {side.bills.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">
            No bills with CT for this project right now.
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {areas.map(([area, rows]) => {
              const total = rows.reduce((s, b) => s + b.amount, 0)
              return (
                <div key={area}>
                  <div className="px-3 py-2 bg-gray-50/60 flex items-center justify-between gap-2">
                    <span className="flex items-center min-w-0 text-sm font-semibold text-gray-800">
                      <CatChevron catId={area} />
                      {area}
                      <span className="ml-2 text-[11px] font-normal text-gray-400">{rows.length} bills</span>
                    </span>
                    <span className="tabular-nums text-sm font-semibold text-gray-900">{formatINR(total)}</span>
                  </div>
                  <CatRows catId={area}>
                    {rows.map(b => (
                      <div key={b.id} className="px-4 py-2.5 border-t border-gray-100 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="min-w-0">
                          <span className="block text-sm text-gray-900 truncate">{b.vendor || '(no vendor)'}</span>
                          <span className="block text-[11px] text-gray-500 font-mono">
                            {b.invoiceNo || '—'}
                            {b.billDate ? ` · ${formatDate(b.billDate)}` : ''}
                          </span>
                        </span>
                        <span className="flex items-center gap-3 flex-shrink-0">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
                            b.ageDays >= 30 ? 'bg-rose-100 text-rose-800'
                            : b.ageDays >= 14 ? 'bg-amber-100 text-amber-800'
                            : 'bg-gray-100 text-gray-600'
                          }`}>
                            {b.ageDays}d with CT
                          </span>
                          <span className="tabular-nums font-semibold text-gray-900">{formatINR(b.amount)}</span>
                        </span>
                      </div>
                    ))}
                  </CatRows>
                </div>
              )
            })}
          </div>
        )}

        <p className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-500 flex flex-wrap gap-x-3">
          {side.asOf && <span>Report generated {formatDate(side.asOf)}</span>}
          {side.unattributed.count > 0 && (
            <span className="text-amber-700">
              {side.unattributed.count} bills ({formatINR(side.unattributed.amount)}) name an area
              no project in CT Hub has
            </span>
          )}
          <Link href="/bills-pipeline" className="text-indigo-700 hover:underline font-medium">
            Open the full pipeline →
          </Link>
        </p>
      </div>
    </TreeProvider>
  )
}

/** ₹ with the /sft companion beneath, exactly as the Internal Estimate shows it. */
function Money({ value, sft, className = '' }: { value: number; sft: number; className?: string }) {
  if (!value) return <span className="text-gray-300">—</span>
  const per = sft > 0 ? Math.round(value / sft) : 0
  return (
    <span className={className}>
      {formatINR(value)}
      {per > 0 && (
        <span className="block text-[10px] font-normal text-gray-400 tabular-nums">
          ₹{per.toLocaleString('en-IN')}/sft
        </span>
      )}
    </span>
  )
}

function SideTable({ title, side, partyLabel, sft }: {
  title: string; side: ReportSide; partyLabel: string; sft: number
}) {
  if (side.categories.length === 0) return null
  const catIds = side.categories.map(c => c.category)

  return (
    <TreeProvider allCatIds={catIds} emptyCount={0}>
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50/60 gap-2 flex-wrap">
          <span className="text-sm font-bold text-gray-900">
            {title}
            <span className="ml-2 text-[11px] font-normal text-gray-500">
              from {side.subProjects.length} sub-project{side.subProjects.length === 1 ? '' : 's'}
            </span>
          </span>
          <TreeToolbar />
        </div>

        {/* Desktop — header cells carry their own sticky + opaque background,
            and the BODY scrolls in this box. See AGENTS.md: page-level sticky
            does not work anywhere in this app. */}
        <div className="overflow-auto max-h-[70vh] hidden md:block">
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 min-w-[260px]">Category / {partyLabel}</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-32">WO / PO</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-32">Billed</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-32">Paid</th>
                <th className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 font-semibold text-gray-600 text-right w-28">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {side.categories.map(c => {
                const outstanding = c.parties.reduce((s, p) => s + p.outstanding, 0)
                return (
                  <Fragment key={c.category}>
                    <tr className="bg-gray-50/60 border-t border-gray-200">
                      <td className="px-3 py-2 font-semibold text-gray-800">
                        <CatChevron catId={c.category} />
                        {c.category}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600"><Money value={c.wo} sft={sft} /></td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900"><Money value={c.bill} sft={sft} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-600"><Money value={c.paid} sft={sft} /></td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">{outstanding > 0 ? formatINR(outstanding) : '—'}</td>
                    </tr>
                    <CatRows catId={c.category}>
                      {c.parties.map(p => (
                        <SubRow key={p.party} empty={false}>
                          <tr className="border-t border-gray-100 hover:bg-gray-50/60">
                            <td className="pl-9 pr-3 py-2 text-gray-700">{p.party}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600"><Money value={p.wo} sft={sft} /></td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-900"><Money value={p.bill} sft={sft} /></td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600"><Money value={p.paid} sft={sft} /></td>
                            <td className="px-3 py-2 text-right tabular-nums text-amber-700">{p.outstanding > 0 ? formatINR(p.outstanding) : '—'}</td>
                          </tr>
                        </SubRow>
                      ))}
                    </CatRows>
                  </Fragment>
                )
              })}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <td className="px-3 py-2 text-gray-900">Total</td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700"><Money value={side.wo} sft={sft} /></td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-900"><Money value={side.bill} sft={sft} /></td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-700"><Money value={side.paid} sft={sft} /></td>
                <td className="px-3 py-2"></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Mobile — the same data as cards, with the category bar pinning as
            you scroll its rows. Its own scroll box, same reason as above. */}
        <div className="md:hidden divide-y divide-gray-100 overflow-auto max-h-[70vh]">
          {side.categories.map(c => (
            <div key={c.category}>
              <div className="sticky top-0 z-10 px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2">
                <span className="flex items-center min-w-0 text-[12px] font-semibold text-gray-800">
                  <CatChevron catId={c.category} />
                  <span className="truncate">{c.category}</span>
                </span>
                <span className="text-[11px] text-gray-600 flex-shrink-0 whitespace-nowrap tabular-nums">
                  {formatINR(c.bill)}
                </span>
              </div>
              <CatRows catId={c.category}>
                {c.parties.map(p => (
                  <div key={p.party} className="px-4 py-3">
                    <p className="text-sm text-gray-900">{p.party}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
                      <span>WO <span className="font-semibold text-gray-700 tabular-nums">{p.wo ? formatINR(p.wo) : '—'}</span></span>
                      <span>Billed <span className="font-semibold text-gray-900 tabular-nums">{formatINR(p.bill)}</span></span>
                      <span>Paid <span className="font-semibold text-gray-700 tabular-nums">{formatINR(p.paid)}</span></span>
                      {p.outstanding > 0 && (
                        <span>Outstanding <span className="font-semibold text-amber-700 tabular-nums">{formatINR(p.outstanding)}</span></span>
                      )}
                    </div>
                  </div>
                ))}
              </CatRows>
            </div>
          ))}
          <div className="px-4 py-3 bg-gray-50 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">Total billed</span>
            <span className="text-sm font-bold tabular-nums text-gray-900">{formatINR(side.bill)}</span>
          </div>
        </div>
      </div>
    </TreeProvider>
  )
}
