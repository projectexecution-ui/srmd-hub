// Cumulative money strip (cc_cumulative_versions). Shown on a revision (v2+)
// so the Trustee reads, at a glance: how much is already released, what THIS
// version newly asks, and the cumulative after this. Management-facing.

import { formatINR } from '@/lib/utils'
import type { CumulativeMoney } from '@/lib/cost-control/version-ledger'

export function VersionLedgerStrip({ money, versionNo }: { money: CumulativeMoney; versionNo: number }) {
  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-wide text-indigo-700/70">
          Cumulative — version {versionNo}
        </p>
        <span className="text-[11px] text-indigo-700/60">{money.priorCount} earlier version{money.priorCount === 1 ? '' : 's'}</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-gray-500">Already approved</span>
          <p className="font-bold text-gray-800 tabular-nums">{formatINR(money.alreadyApproved)}</p>
          <span className="text-[10px] text-gray-400">released so far</span>
        </div>
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-amber-700">This ask (new)</span>
          <p className={`font-bold tabular-nums ${money.thisAsk < 0 ? 'text-emerald-700' : 'text-amber-800'}`}>
            {money.thisAsk < 0 ? `−${formatINR(Math.abs(money.thisAsk))}` : formatINR(money.thisAsk)}
          </p>
          <span className="text-[10px] text-gray-400">{money.thisAsk < 0 ? 'scope reduced' : 'over and above'}</span>
        </div>
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-indigo-700">Cumulative</span>
          <p className="font-bold text-indigo-900 tabular-nums">{formatINR(money.cumulative)}</p>
          <span className="text-[10px] text-gray-400">full BOQ this version</span>
        </div>
      </div>
    </div>
  )
}
