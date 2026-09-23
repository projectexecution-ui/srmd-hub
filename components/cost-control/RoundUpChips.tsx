'use client'
// Nominal round-up for an approval figure — Aksha, 23 Sep 2026: "when i want
// to add a little amount to make the approval round figure … the round off
// options are too high, want very nominal". Three chips: the next thousand,
// ten thousand and lakh ABOVE the figure, each showing what it adds. Computed
// from the figure, so on any sheet the buffer stays in hundreds or a few
// thousands, never lakhs.

import { formatINR } from '@/lib/utils'

const STEPS = [1_000, 10_000, 100_000]

export function roundUpOptions(base: number): Array<{ value: number; adds: number }> {
  if (!Number.isFinite(base) || base <= 0) return []
  const out: Array<{ value: number; adds: number }> = []
  for (const s of STEPS) {
    const v = Math.ceil(base / s) * s
    const adds = v - base
    if (adds <= 0) continue                      // already round at this step
    if (out.some(o => o.value === v)) continue   // two steps landing on one figure
    out.push({ value: v, adds })
  }
  return out
}

export function RoundUpChips({ base, current, onPick, disabled }: {
  /** The figure being approved as asked (grand total or remaining balance). */
  base: number
  /** What is typed right now, so the matching chip reads as selected. */
  current: number | null
  onPick: (value: number) => void
  disabled?: boolean
}) {
  const opts = roundUpOptions(base)
  if (opts.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-gray-500 mr-0.5">Round up to</span>
      {opts.map(o => {
        const on = current != null && Math.round(current) === o.value
        return (
          <button
            key={o.value} type="button" disabled={disabled}
            onClick={() => onPick(o.value)}
            aria-pressed={on}
            className={`inline-flex items-baseline gap-1 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold tabular-nums min-h-[30px] ${
              on ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
            } disabled:opacity-50`}
            title={`Adds ${formatINR(o.adds)} over the asked figure`}
          >
            {formatINR(o.value)}
            <span className="text-[10px] font-medium text-gray-400">+{formatINR(o.adds)}</span>
          </button>
        )
      })}
    </div>
  )
}
