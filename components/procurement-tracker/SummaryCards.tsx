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
  const linePct = summary.lines.length > 0
    ? Math.round(((summary.lines.length - summary.pendingLineCount) / summary.lines.length) * 100)
    : 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
      <KPI
        accent="stone"
        label="Indents"
        value={String(summary.total)}
        sub={`${summary.indentOnlyNoPo} need PO`}
      />
      <KPI
        accent="red"
        label="Items pending receipt"
        value={String(summary.pendingLineCount)}
        sub={`of ${summary.lines.length} material lines`}
      />
      <KPI
        accent="amber"
        label="Pending value"
        value={summary.pendingValue > 0 ? fmtINR(summary.pendingValue) : '—'}
        sub="ordered · not yet received"
      />
      <KPI
        accent="emerald"
        label="GRN received value"
        value={summary.totalGrnValue > 0 ? fmtINR(summary.totalGrnValue) : '—'}
        sub={`${linePct}% of lines fulfilled`}
      />
      <KPI
        accent="blue"
        label="Total PO value"
        value={summary.totalPoValue > 0 ? fmtINR(summary.totalPoValue) : '—'}
        sub={`${summary.poRaisedGrnPending + summary.poDoneGrnReceived} indents have PO`}
      />

      {/* Full-width completion bar — over LINES, not indents */}
      <div className="col-span-2 sm:col-span-5 bg-stone-50 rounded-xl border border-stone-200 p-4">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs text-stone-500">Line fulfilment</p>
          <p className="text-xs text-stone-600 font-medium">
            <span className="text-emerald-700">
              {summary.lines.filter(l => l.status === 'received').length} received
            </span>
            <span className="text-stone-300 mx-1.5">·</span>
            <span className="text-amber-700">
              {summary.lines.filter(l => l.status === 'partial').length} partial
            </span>
            <span className="text-stone-300 mx-1.5">·</span>
            <span className="text-orange-700">
              {summary.lines.filter(l => l.status === 'pending').length} pending
            </span>
            <span className="text-stone-300 mx-1.5">·</span>
            <span className="text-red-700">
              {summary.lines.filter(l => l.status === 'no_po').length} no PO
            </span>
          </p>
        </div>
        <div className="h-2 w-full bg-stone-200 rounded-full overflow-hidden flex">
          {(() => {
            const total = summary.lines.length || 1
            const w = (n: number) => `${(n / total) * 100}%`
            const r = summary.lines.filter(l => l.status === 'received').length
            const pa = summary.lines.filter(l => l.status === 'partial').length
            const pe = summary.lines.filter(l => l.status === 'pending').length
            const n = summary.lines.filter(l => l.status === 'no_po').length
            return (
              <>
                <div className="h-full bg-emerald-500" style={{ width: w(r) }} />
                <div className="h-full bg-amber-400"   style={{ width: w(pa) }} />
                <div className="h-full bg-orange-400"  style={{ width: w(pe) }} />
                <div className="h-full bg-red-400"     style={{ width: w(n) }} />
              </>
            )
          })()}
        </div>
        <p className="text-[11px] text-stone-400 mt-1.5">
          Indent rollup: {summary.poDoneGrnReceived} done · {summary.poRaisedGrnPending} pending · {summary.indentOnlyNoPo} no-PO ({pct(summary.poDoneGrnReceived)}% complete)
        </p>
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
