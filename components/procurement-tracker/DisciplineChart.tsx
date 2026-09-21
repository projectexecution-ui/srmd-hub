'use client'
import type { ProjectSummary } from '@/lib/procurement'

export function DisciplineChart({ summary }: { summary: ProjectSummary }) {
  const entries = Object.entries(summary.byDiscipline)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 12)

  const max = Math.max(...entries.map(([, v]) => v.total))

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-5 mb-6">
      <h3 className="text-sm font-medium text-stone-700 mb-4">Indents by discipline</h3>
      <div className="space-y-2.5">
        {entries.map(([disc, counts]) => (
          <div key={disc} className="flex items-center gap-3">
            <span className="text-xs text-stone-500 w-44 truncate flex-shrink-0" title={disc}>
              {disc}
            </span>
            <div className="flex-1 h-5 bg-stone-100 rounded overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full"
                style={{ width: `${(counts.done / max) * 100}%` }}
                title={`GRN done: ${counts.done}`}
              />
              <div
                className="bg-amber-400 h-full"
                style={{ width: `${(counts.pending / max) * 100}%` }}
                title={`GRN pending: ${counts.pending}`}
              />
              <div
                className="bg-red-400 h-full"
                style={{ width: `${(counts.noPo / max) * 100}%` }}
                title={`No PO: ${counts.noPo}`}
              />
            </div>
            <span className="text-xs text-stone-500 w-6 text-right flex-shrink-0">
              {counts.total}
            </span>
          </div>
        ))}
      </div>

      <div className="flex gap-5 mt-4 pt-3 border-t border-stone-100">
        <span className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" />
          GRN done
        </span>
        <span className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" />
          GRN pending
        </span>
        <span className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="w-3 h-3 rounded-sm bg-red-400 inline-block" />
          No PO
        </span>
      </div>
    </div>
  )
}
