'use client'
import type { ProjectSummary } from '@/lib/procurement-tracker'
import { AlertTriangle, PackageX, Clock } from 'lucide-react'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

export function ActionStrip({ summary }: { summary: ProjectSummary }) {
  const oldest = summary.oldestPendingPo
  const biggest = summary.biggestPendingGrn

  // Only show if there's anything to flag
  if (!oldest && !biggest && summary.indentOnlyNoPo === 0) return null

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
      {/* Oldest indent stuck without a PO */}
      {oldest ? (
        <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-red-500">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
            <Clock className="h-3 w-3 text-red-500" /> Oldest pending PO
          </p>
          <p className="text-sm font-bold text-stone-800 truncate" title={oldest.indentNo}>
            {oldest.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')}
          </p>
          <p className="text-xs text-stone-500 mt-0.5">
            {oldest.ageDays != null ? `${oldest.ageDays}d old · ` : ''}{oldest.block}
          </p>
        </div>
      ) : (
        <div className="bg-stone-50 rounded-xl border border-stone-200 p-4 text-center text-xs text-stone-400">
          No PO-pending indents
        </div>
      )}

      {/* Biggest PO waiting for GRN */}
      {biggest && biggest.poValue > 0 ? (
        <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-amber-500">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
            <PackageX className="h-3 w-3 text-amber-500" /> Biggest pending GRN
          </p>
          <p className="text-sm font-bold text-stone-800">{fmtINR(biggest.poValue)}</p>
          <p className="text-xs text-stone-500 mt-0.5 truncate" title={`${biggest.indentNo} · ${biggest.supplier}`}>
            {biggest.indentNo.replace('IND/SRASSK/', '').replace('IND/SRET/', '')} · {biggest.supplier || '—'}
          </p>
        </div>
      ) : (
        <div className="bg-stone-50 rounded-xl border border-stone-200 p-4 text-center text-xs text-stone-400">
          No PO-pending GRN value to flag
        </div>
      )}

      {/* Total no-PO count as the "do something" reminder */}
      <div className="bg-white rounded-xl border border-stone-200 p-4 border-l-4 border-l-stone-700">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5 mb-1">
          <AlertTriangle className="h-3 w-3 text-stone-700" /> Indents needing PO
        </p>
        <p className="text-sm font-bold text-stone-800">{summary.indentOnlyNoPo}</p>
        <p className="text-xs text-stone-500 mt-0.5">action — raise POs against these</p>
      </div>
    </div>
  )
}
