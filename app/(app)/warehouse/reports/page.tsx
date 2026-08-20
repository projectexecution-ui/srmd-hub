import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { REGISTER_META } from '@/lib/warehouse/registers'
import type { RegisterKind } from '@/lib/warehouse/registers'
import { groupedControlReports, DEFERRED_REPORTS } from '@/lib/warehouse/exceptions'
import type { ReportMeta } from '@/lib/warehouse/exceptions'
import { ChevronLeft, ChevronRight, Boxes, CalendarDays } from 'lucide-react'

export const dynamic = 'force-dynamic'

const REGISTERS: RegisterKind[] = ['vendor-in', 'vendor-out', 'srm-in', 'srm-out']

/** One row per report — title, then the blurb. The italic "question" line that
 *  used to sit under every card is gone from the index: fourteen cards times
 *  three lines is a wall, and the question is on the report itself where it
 *  actually helps. */
function ReportRow({ report }: { report: ReportMeta }) {
  return (
    <Link href={`/warehouse/reports/control/${report.key}`}
      className="block px-3 py-2.5 hover:bg-emerald-50/40 transition">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-bold text-slate-800 min-w-0">{report.title}</span>
        <ChevronRight className="h-3.5 w-3.5 text-slate-400 ml-auto flex-shrink-0" />
      </div>
      <p className="text-[11.5px] text-slate-500 mt-0.5 leading-snug">{report.blurb}</p>
    </Link>
  )
}

export default async function ReportsPage() {
  await requirePermission('warehouse', 'view')
  const { groups, orphans } = groupedControlReports()

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Registers & reports"
        subtitle="Every figure here traces back to an entry somebody signed for."
      />

      {/* Day by day, first — the question asked most often, and where the old
          module put it. It used to need its own tile on the home screen. */}
      <Link href="/warehouse/daily" className="block">
        <Card className="p-3 shadow-sm hover:border-emerald-300 hover:shadow transition flex items-center gap-3">
          <span className="rounded-lg bg-emerald-50 p-2 flex-shrink-0">
            <CalendarDays className="h-5 w-5 text-emerald-600" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-bold text-slate-800 text-[13px]">Daily movement</span>
            <span className="block text-[11.5px] text-slate-500 mt-0.5 leading-snug">
              What moved on a day — in, out, across the yard, and where each load went
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
        </Card>
      </Link>

      {/* The five registers — what happened. One line each. */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">
          The five registers
        </h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {REGISTERS.map(kind => (
            <Link key={kind} href={`/warehouse/reports/${kind}`} className="block">
              <Card className="p-3 shadow-sm h-full hover:border-emerald-300 hover:shadow transition">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-800 text-[13px]">{REGISTER_META[kind].title}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 ml-auto" />
                </div>
                <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">{REGISTER_META[kind].blurb}</p>
              </Card>
            </Link>
          ))}

          {/* The fifth is a balance, not a list of entries, so it IS the stock
              screen rather than a second copy of it. */}
          <Link href="/warehouse/stock" className="block">
            <Card className="p-3 shadow-sm h-full hover:border-emerald-300 hover:shadow transition">
              <div className="flex items-center gap-1.5">
                <Boxes className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                <span className="font-bold text-slate-800 text-[13px]">Total Stock</span>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400 ml-auto" />
              </div>
              <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">
                What lies where, as on a date — this one is the Stock screen itself
              </p>
            </Card>
          </Link>
        </div>
      </div>

      {/* Control reports — what is WRONG. Three short lists instead of one wall
          of fourteen, grouped by what the reader is actually worried about.
          Nothing is hidden: every report is on the screen. */}
      <div className="space-y-3">
        <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
          Control reports
        </h3>
        {groups.map(g => (
          <Card key={g.label} className="p-0 shadow-sm overflow-hidden">
            <div className="px-3 pt-2.5 pb-2 bg-slate-50/70 border-b border-slate-100">
              <p className="text-[12.5px] font-extrabold text-slate-700">{g.label}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{g.blurb}</p>
            </div>
            <div className="divide-y divide-slate-100">
              {g.reports.map(r => <ReportRow key={r.key} report={r} />)}
            </div>
          </Card>
        ))}

        {/* Only ever rendered if somebody added a report and forgot to group it.
            A unit test fails on this, but the screen still shows it rather than
            losing it. */}
        {orphans.length > 0 && (
          <Card className="p-0 shadow-sm overflow-hidden">
            <div className="px-3 pt-2.5 pb-2 bg-amber-50 border-b border-amber-200">
              <p className="text-[12.5px] font-extrabold text-amber-900">Ungrouped</p>
              <p className="text-[11px] text-amber-800 mt-0.5">
                These are not yet filed under a heading. They work — they just need naming.
              </p>
            </div>
            <div className="divide-y divide-slate-100">
              {orphans.map(r => <ReportRow key={r.key} report={r} />)}
            </div>
          </Card>
        )}
      </div>

      {/* Not built, and the reason why — folded away, because it is a footnote
          rather than a menu. Listed rather than dropped: a menu that quietly
          loses an item is how a requirement gets forgotten. */}
      <details className="group">
        <summary className="cursor-pointer text-[11.5px] font-semibold text-slate-500 hover:text-slate-700 list-none inline-flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
          {DEFERRED_REPORTS.length} more not built yet — and why
        </summary>
        <Card className="p-0 shadow-sm overflow-hidden mt-2">
          <div className="divide-y divide-slate-100">
            {DEFERRED_REPORTS.map(d => (
              <div key={d.title} className="px-3 py-2.5">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[12.5px] font-bold text-slate-600">{d.title}</span>
                  <span className="text-[11.5px] text-slate-400">{d.blurb}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">{d.why}</p>
              </div>
            ))}
          </div>
        </Card>
      </details>
    </div>
  )
}
