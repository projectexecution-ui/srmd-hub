import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { REGISTER_META } from '@/lib/warehouse/registers'
import type { RegisterKind } from '@/lib/warehouse/registers'
import { ChevronLeft, ChevronRight, Boxes } from 'lucide-react'

export const dynamic = 'force-dynamic'

const MINDMAP: Array<{ kind: RegisterKind }> = [
  { kind: 'vendor-in' }, { kind: 'vendor-out' }, { kind: 'srm-in' }, { kind: 'srm-out' },
]

/** The reports the review added on top of the mindmap. Listed here rather than
 *  hidden, so it is clear what is coming and what is not built yet — a menu that
 *  only shows finished things makes the rest look forgotten. (S7) */
const REVIEW_REPORTS = [
  ['Physical count & variance', 'Book vs counted, shortage value, signed off'],
  ['Vendor material balance', 'Brought vs taken back per vendor — warns if he takes more'],
  ['Shortage & damage', 'Challan vs received, damaged quantity, by supplier'],
  ['No-PO exceptions', 'Emergency entries per month per site'],
  ['Dead stock ageing', 'No movement in 60 / 90 / 180 days'],
  ['Returnables outstanding', '"Scaffolding out 47 days, not returned"'],
  ['Entity vs project', 'Cross-entity consumption needing settlement'],
  ['Rate variance', 'Same item, different rate across entities'],
  ['Issued vs estimate', 'Consumption against Internal Estimate, per discipline'],
  ['Entry number gaps', 'Missing IN / OUT numbers — an unrecorded movement'],
  ['Edit history', 'Every correction, who and when'],
  ['Stock as on period-end', 'Frozen figure for accounts'],
  ['PO-wise pending', 'Ordered · received · pending · days since last delivery'],
  ['Over-receipt', 'More delivered than ordered, awaiting settlement'],
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
          Control reports — next
        </h3>
        <Card className="p-0 shadow-sm overflow-hidden opacity-90">
          <div className="divide-y divide-slate-50">
            {REVIEW_REPORTS.map(([title, blurb]) => (
              <div key={title} className="px-3 py-2 flex items-baseline gap-2">
                <span className="text-[12.5px] font-semibold text-slate-600">{title}</span>
                <span className="text-[11.5px] text-slate-400 truncate">{blurb}</span>
              </div>
            ))}
          </div>
        </Card>
        <p className="text-[11px] text-slate-500 mt-1.5 px-1">
          These are the exception reports the design review added — the ones that go looking for what is wrong
          rather than listing what happened. They are the next stage of the build, not part of this one.
        </p>
      </div>
    </div>
  )
}
