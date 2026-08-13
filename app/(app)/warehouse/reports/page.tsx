import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { REGISTER_META } from '@/lib/warehouse/registers'
import type { RegisterKind } from '@/lib/warehouse/registers'
import { CONTROL_REPORTS, DEFERRED_REPORTS } from '@/lib/warehouse/exceptions'
import { ChevronLeft, ChevronRight, Boxes } from 'lucide-react'

export const dynamic = 'force-dynamic'

const MINDMAP: Array<{ kind: RegisterKind }> = [
  { kind: 'vendor-in' }, { kind: 'vendor-out' }, { kind: 'srm-in' }, { kind: 'srm-out' },
]


export default async function ReportsPage() {
  await requirePermission('warehouse', 'view')

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Registers & reports"
        subtitle="The same gate entries, read several ways. Every figure here traces back to an entry somebody signed for."
      />

      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">
          The five registers
        </h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {MINDMAP.map(({ kind }) => {
            const m = REGISTER_META[kind]
            return (
              <Link key={kind} href={`/warehouse/reports/${kind}`} className="block">
                <Card className="p-4 shadow-sm h-full hover:border-emerald-300 hover:shadow transition">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-slate-800 text-sm">{m.title}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                  </div>
                  <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">{m.blurb}</p>
                  <p className="text-[11px] text-slate-400 mt-1.5 italic">{m.question}</p>
                </Card>
              </Link>
            )
          })}

          {/* The fifth is a balance, not a list of entries, so it IS the stock
              screen rather than a second copy of it. */}
          <Link href="/warehouse/stock" className="block">
            <Card className="p-4 shadow-sm h-full hover:border-emerald-300 hover:shadow transition">
              <div className="flex items-center gap-1.5">
                <Boxes className="h-4 w-4 text-emerald-600" />
                <span className="font-bold text-slate-800 text-sm">Total Stock</span>
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              </div>
              <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">
                What lies where, as on a date · storage-location-wise
              </p>
              <p className="text-[11px] text-slate-400 mt-1.5 italic">
                This one is a balance rather than a list of entries, so it is the Stock screen itself.
              </p>
            </Card>
          </Link>
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">
          Control reports
        </h3>
        <p className="text-[11.5px] text-slate-500 mb-2 px-0.5">
          The registers list what happened. These go looking for what is <b>wrong</b> — and each one is
          written so that coming back empty reads as good news, not a broken screen.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {CONTROL_REPORTS.map(r => (
            <Link key={r.key} href={`/warehouse/reports/control/${r.key}`} className="block">
              <Card className="p-4 shadow-sm h-full hover:border-emerald-300 hover:shadow transition">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-slate-800 text-sm">{r.title}</span>
                  {!r.usesPeriod && (
                    <span className="text-[9px] font-extrabold uppercase tracking-wide bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5">
                      as at today
                    </span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-slate-400 ml-auto flex-shrink-0" />
                </div>
                <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">{r.blurb}</p>
                <p className="text-[11px] text-slate-400 mt-1.5 italic">{r.question}</p>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Not built, and the reason why. A menu that quietly loses an item is how
          a requirement gets forgotten. */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-2">
          Not built yet — and why
        </h3>
        <Card className="p-0 shadow-sm overflow-hidden">
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
      </div>
    </div>
  )
}
