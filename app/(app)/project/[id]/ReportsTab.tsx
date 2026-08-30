import { formatINR } from '@/lib/utils'
import { EmptyState } from '@/components/ui/empty-state'
import { loadProjectReports, type ReportSide } from '@/lib/revamp/reports-data'
import { FileBarChart, AlertTriangle } from 'lucide-react'

/**
 * Contractor and Supplier money for one project, as a tree —
 * category → party — which is the shape Aksha asked for ("same as Budget vs
 * Actual View"). Collapsed by default via <details>, per his standing rule
 * that long lists start rolled up.
 */
export async function ReportsTab({ projectId }: { projectId: string }) {
  const { contractor, supplier, unattributed } = await loadProjectReports(projectId)
  const nothing = contractor.categories.length === 0 && supplier.categories.length === 0

  return (
    <section className="space-y-4">
      <header className="flex items-start gap-2.5">
        <FileBarChart className="h-4 w-4 mt-0.5 text-gray-400" />
        <div>
          <h2 className="text-sm font-bold text-gray-900">Contractor &amp; Supplier</h2>
          <p className="text-xs text-gray-500">
            From the weekly IN4 uploads, attributed to this project by sub-project name.
          </p>
        </div>
      </header>

      {nothing ? (
        <EmptyState
          title="Nothing attributed to this project yet"
          description="The uploads hold no sub-project whose name matches this project. See the note below — that is a naming gap, not missing money."
        />
      ) : (
        <>
          <SideBlock title="Contractor" side={contractor} partyLabel="Contractor" />
          <SideBlock title="Supplier" side={supplier} partyLabel="Supplier" />
        </>
      )}

      {/* The holding list. Never hide money we could not place — that is how it
          goes missing without anyone noticing. */}
      {unattributed.subProjects > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {unattributed.subProjects} sub-projects belong to no project in CT Hub
          </p>
          <p className="text-xs text-amber-800 mt-1">
            {formatINR(unattributed.bill)} of billed work sits in the uploads under names the hub does not
            have — either the project has not been created yet, or IN4 spells it differently.
            It is parked here rather than guessed onto a project. The moment the project exists
            or the name is confirmed, it attaches on its own.
          </p>
        </div>
      )}
    </section>
  )
}

function SideBlock({ title, side, partyLabel }: { title: string; side: ReportSide; partyLabel: string }) {
  if (side.categories.length === 0) return null

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500">
          from {side.subProjects.length} sub-project{side.subProjects.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
        <Fig label="WO / PO" value={side.wo} />
        <Fig label="Billed" value={side.bill} />
        <Fig label="Paid" value={side.paid} />
      </div>

      <div className="divide-y divide-gray-100">
        {side.categories.map(c => (
          <details key={c.category} className="group">
            <summary className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 cursor-pointer hover:bg-gray-50 list-none [&::-webkit-details-marker]:hidden min-h-[44px]">
              <span className="flex items-center gap-2 min-w-0">
                <span className="text-gray-400 transition-transform group-open:rotate-90">›</span>
                <span className="text-sm text-gray-900 truncate">{c.category}</span>
                <span className="text-[11px] text-gray-400 whitespace-nowrap">
                  {c.parties.length} {partyLabel.toLowerCase()}{c.parties.length === 1 ? '' : 's'}
                </span>
              </span>
              <span className="tabular-nums text-sm font-semibold text-gray-900">{formatINR(c.bill)}</span>
            </summary>

            <div className="bg-gray-50/60 px-4 pb-2">
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px] min-w-[420px]">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1.5 font-medium">{partyLabel}</th>
                      <th className="py-1.5 font-medium text-right w-28">WO / PO</th>
                      <th className="py-1.5 font-medium text-right w-28">Billed</th>
                      <th className="py-1.5 font-medium text-right w-28">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.parties.map(p => (
                      <tr key={p.party} className="border-t border-gray-200/70">
                        <td className="py-1.5 pr-3 text-gray-800">{p.party}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-600">{p.wo > 0 ? formatINR(p.wo) : '—'}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-900">{formatINR(p.bill)}</td>
                        <td className="py-1.5 text-right tabular-nums text-gray-600">{formatINR(p.paid)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

function Fig({ label, value }: { label: string; value: number }) {
  return (
    <div className="px-4 py-2.5">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{label}</p>
      <p className="text-sm font-bold tabular-nums text-gray-900 mt-0.5">{value > 0 ? formatINR(value) : '—'}</p>
    </div>
  )
}
