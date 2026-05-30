'use client'
import type { VendorRollup } from '@/lib/procurement'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

function lagClass(d: number | null) {
  if (d == null) return 'text-stone-400'
  if (d <= 7) return 'text-emerald-700 font-semibold'
  if (d <= 21) return 'text-amber-700 font-medium'
  return 'text-rose-700 font-bold'
}

function onTimeClass(p: number | null) {
  if (p == null) return 'text-stone-400'
  if (p >= 75) return 'text-emerald-700 font-semibold'
  if (p >= 50) return 'text-amber-700 font-medium'
  return 'text-rose-700 font-bold'
}

export function TopVendors({ vendors, hasInvoices }: { vendors: VendorRollup[]; hasInvoices?: boolean }) {
  if (vendors.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-orange-200 overflow-hidden mt-6">
      <div className="px-4 py-3 border-b border-orange-100">
        <h3 className="text-sm font-semibold text-red-900">Top vendors</h3>
        <p className="text-[11px] text-stone-500 mt-0.5">Sorted by pending value. Avg lag and On-time % are calculated from completed lines.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-orange-50/50">
            <tr>
              <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Vendor</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Lines</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Pending</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Overdue ≥7d</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium" title="Average days between PO and GRN, across this vendor's completed lines">Avg lag</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium" title="Share of received lines whose lag was ≤ 14 days">On-time %</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">PO Value</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Pending Value</th>
              {hasInvoices && (
                <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Invoiced</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-orange-50">
            {vendors.map(v => (
              <tr key={v.name} className="hover:bg-orange-50/40">
                <td className="px-4 py-2 text-stone-800 max-w-xs truncate" title={v.name}>{v.name}</td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-600">{v.indents}</td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-700">{v.pendingLines}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${v.overdueLines > 0 ? 'text-rose-700 font-semibold' : 'text-stone-400'}`}>{v.overdueLines}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${lagClass(v.avgLagDays)}`}>{v.avgLagDays != null ? `${v.avgLagDays}d` : '—'}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${onTimeClass(v.onTimePct)}`}>{v.onTimePct != null ? `${v.onTimePct}%` : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-800">{v.poValue > 0 ? fmtINR(v.poValue) : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums text-amber-700 font-medium">{v.pendingValue > 0 ? fmtINR(v.pendingValue) : '—'}</td>
                {hasInvoices && (
                  <td className="px-4 py-2 text-right tabular-nums text-indigo-700">{v.invoiceAmount > 0 ? fmtINR(v.invoiceAmount) : '—'}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
