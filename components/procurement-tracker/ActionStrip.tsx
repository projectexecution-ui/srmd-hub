'use client'
import type { ProjectSummary } from '@/lib/procurement-tracker'
import { AlertTriangle, PackageX, UserX } from 'lucide-react'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

export function ActionStrip({ summary }: { summary: ProjectSummary }) {
  const oldest = summary.oldestPendingPo
  const biggest = summary.biggestPendingLine
  const worst = summary.worstVendor

  if (!oldest && !biggest && !worst) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
      {oldest ? (
        <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-red-500">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3 w-3 text-red-500" /> Oldest pending PO
          </p>
          <p className="text-sm font-bold text-stone-800 truncate" title={oldest.indentNo}>
            {oldest.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}
          </p>
          <p className="text-xs text-stone-500 mt-0.5">
            {oldest.worstAgeDays != null ? `${oldest.worstAgeDays}d old · ` : ''}{oldest.block || oldest.subProject}
          </p>
          <p className="text-[11px] text-stone-400 mt-0.5">
            {oldest.linesNoPo} of {oldest.totalLines} lines need PO
          </p>
        </div>
      ) : (
        <div className="bg-stone-50 rounded-xl border border-stone-200 p-4 text-center text-xs text-stone-400">
          No indents waiting on PO
        </div>
      )}

      {biggest ? (
        <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-amber-500">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
            <PackageX className="h-3 w-3 text-amber-500" /> Biggest pending receipt
          </p>
          <p className="text-sm font-bold text-stone-800">{fmtINR(biggest.pendingValue)}</p>
          <p className="text-xs text-stone-500 mt-0.5 truncate" title={`${biggest.material} · ${biggest.supplier}`}>
            {biggest.material || biggest.indentNo} · {biggest.supplier || '—'}
          </p>
          <p className="text-[11px] text-stone-400 mt-0.5 tabular-nums">
            pending {biggest.pendingQty.toLocaleString('en-IN')} {biggest.uom}
            {biggest.oldestPoAgeDays != null ? ` · ${biggest.oldestPoAgeDays}d since PO` : ''}
          </p>
        </div>
      ) : (
        <div className="bg-stone-50 rounded-xl border border-stone-200 p-4 text-center text-xs text-stone-400">
          No outstanding receipts
        </div>
      )}

      {worst ? (
        <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-rose-500">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
            <UserX className="h-3 w-3 text-rose-500" /> Worst-offender vendor
          </p>
          <p className="text-sm font-bold text-stone-800 truncate" title={worst.name}>{worst.name}</p>
          <p className="text-xs text-stone-500 mt-0.5">
            {worst.overdueLines} overdue · {worst.pendingLines} pending total
          </p>
          <p className="text-[11px] text-stone-400 mt-0.5">
            {fmtINR(worst.pendingValue)} owed
          </p>
        </div>
      ) : (
        <div className="bg-stone-50 rounded-xl border border-stone-200 p-4 text-center text-xs text-stone-400">
          No vendor backlog
        </div>
      )}
    </div>
  )
}
