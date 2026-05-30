'use client'
import type { VendorRollup } from '@/lib/procurement-tracker'

function fmtINR(n: number) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`
  return `₹${n.toLocaleString('en-IN')}`
}

export function TopVendors({ vendors }: { vendors: VendorRollup[] }) {
  if (vendors.length === 0) return null
  return (
    <div className="bg-white rounded-xl border border-stone-200 overflow-hidden mt-6">
      <div className="px-4 py-3 border-b border-stone-100">
        <h3 className="text-sm font-semibold text-stone-700">Top vendors by pending value</h3>
        <p className="text-[11px] text-stone-400 mt-0.5">Sorted by what they still owe you. Use these to chase the purchase team.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50">
            <tr>
              <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Vendor</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Lines</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Pending lines</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Overdue (≥7d)</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">PO Value</th>
              <th className="text-right px-4 py-2 text-[11px] uppercase tracking-wide text-stone-500 font-medium">Pending Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-50">
            {vendors.map(v => (
              <tr key={v.name} className="hover:bg-stone-50">
                <td className="px-4 py-2 text-stone-800 max-w-xs truncate" title={v.name}>{v.name}</td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-600">{v.indents}</td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-700">{v.pendingLines}</td>
                <td className={`px-4 py-2 text-right tabular-nums font-medium ${v.overdueLines > 0 ? 'text-rose-700' : 'text-stone-400'}`}>
                  {v.overdueLines}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-800">{v.poValue > 0 ? fmtINR(v.poValue) : '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums text-amber-700 font-medium">{v.pendingValue > 0 ? fmtINR(v.pendingValue) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
