// One rule for "how used is this budget", shared by every tab that colours a
// percentage. It lived as a copy in each component, and copies drift
// (docs/audit/04-UX-SCENARIOS.md, item 15).

export const USED_THRESHOLDS = [
  { above: 100, tone: 'text-rose-700',    label: 'over budget' },
  { above: 95,  tone: 'text-red-600',     label: '95–100 %' },
  { above: 80,  tone: 'text-amber-700',   label: '80–95 %' },
  { above: -Infinity, tone: 'text-emerald-700', label: 'under 80 %' },
] as const

/** Tailwind text colour for a % used. Null (no figure) is quiet grey. */
export function usedTone(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return 'text-gray-400'
  return USED_THRESHOLDS.find(t => pct > t.above)?.tone ?? 'text-emerald-700'
}

/** The dot colours for the legend, darkest first, same order as the table reads. */
export const USED_LEGEND = [...USED_THRESHOLDS].map(t => ({
  label: t.label,
  dot: t.tone.replace('text-', 'bg-'),
}))
