'use client'
import type { ProjectSummary } from '@/lib/procurement-tracker'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

export function SummaryCards({ summary }: { summary: ProjectSummary }) {
  const pct = (v: number) => summary.total > 0 ? Math.round((v / summary.total) * 100) : 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <KPI
        accent="stone"
        label="Total Indents"
        value={String(summary.total)}
        sub={`${summary.indentOnlyNoPo} need PO`}
      />
      <KPI
        accent="blue"
        label="Total PO Value"
        value={summary.totalPoValue > 0 ? fmtINR(summary.totalPoValue) : '—'}
        sub={`${summary.poRaisedGrnPending + summary.poDoneGrnReceived} indents have PO`}
      />
      <KPI
        accent="amber"
        label="Pending GRN Value"
        value={summary.pendingGrnValue > 0 ? fmtINR(summary.pendingGrnValue) : '—'}
        sub="ordered · not yet received"
      />
      <KPI
        accent="emerald"
        label="GRN Received Value"
        value={summary.totalGrnValue > 0 ? fmtINR(summary.totalGrnValue) : '—'}
        sub={`${summary.poDoneGrnReceived} of ${summary.total} fulfilled · ${pct(summary.poDoneGrnReceived)}%`}
      />

      {/* Full-width completion bar */}
      <div className="col-span-2 sm:col-span-4 bg-stone-50 rounded-xl border border-stone-200 p-4">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-stone-500">Completion</p>
          <p className="text-xs text-stone-600 font-medium">
            <span className="text-emerald-700">{summary.poDoneGrnReceived} GRN done</span>
            <span className="text-stone-300 mx-1.5">·</span>
            <span className="text-amber-700">{summary.poRaisedGrnPending} pending GRN</span>
            <span className="text-stone-300 mx-1.5">·</span>
            <span className="text-red-700">{summary.indentOnlyNoPo} no PO</span>
          </p>
        </div>
        <div className="h-2 w-full bg-stone-200 rounded-full overflow-hidden flex">
          <div className="h-full bg-emerald-500" style={{ width: `${pct(summary.poDoneGrnReceived)}%` }} />
          <div className="h-full bg-amber-400" style={{ width: `${pct(summary.poRaisedGrnPending)}%` }} />
          <div className="h-full bg-red-400" style={{ width: `${pct(summary.indentOnlyNoPo)}%` }} />
        </div>
      </div>
    </div>
  )
}

type Accent = 'stone' | 'blue' | 'amber' | 'emerald' | 'red'
const ACCENT_LINE: Record<Accent, string> = {
  stone:   'bg-stone-700',
  blue:    'bg-blue-600',
  amber:   'bg-amber-500',
  emerald: 'bg-emerald-500',
  red:     'bg-red-500',
}
const ACCENT_VALUE: Record<Accent, string> = {
  stone:   'text-stone-900',
  blue:    'text-blue-700',
  amber:   'text-amber-700',
  emerald: 'text-emerald-700',
  red:     'text-red-700',
}

function KPI({ accent, label, value, sub }: { accent: Accent; label: string; value: string; sub: string }) {
  return (
    <div className="relative bg-white rounded-xl border border-stone-200 p-4 overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${ACCENT_LINE[accent]}`} />
      <p className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${ACCENT_VALUE[accent]}`}>{value}</p>
      <p className="text-xs text-stone-400 mt-1">{sub}</p>
    </div>
  )
}
