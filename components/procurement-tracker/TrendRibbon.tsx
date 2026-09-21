'use client'
import type { TrendPoint } from '@/lib/procurement'

export function TrendRibbon({ trend }: { trend: TrendPoint[] }) {
  if (trend.length < 2) return null
  const first = trend[0].pendingLineCount
  const last = trend[trend.length - 1].pendingLineCount
  const deltaPct = first > 0 ? Math.round(((last - first) / first) * 100) : 0
  const trendColor = last < first ? 'text-emerald-700' : last > first ? 'text-rose-700' : 'text-stone-500'
  const arrow = last < first ? '↓' : last > first ? '↑' : '→'
  return (
    <div className={`text-[11px] mt-0.5 ${trendColor}`}>
      Pending items: {trend.map(t => t.pendingLineCount).join(' → ')}{' '}
      <span className="font-semibold">{arrow} {Math.abs(deltaPct)}%</span>{' '}
      <span className="text-stone-400">over {trend.length} uploads</span>
    </div>
  )
}
