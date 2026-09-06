// Shadow mode: what IN4 says today vs what the last uploaded Excel said.
//
// The upload stays the source of truth until Aksha flips the switch, so every
// sync first compares itself against the stored upload and records how close
// it got. "Close" is judged per figure: within ₹1 is exact (Excel rounding),
// within 0.5% is near, anything else is off and listed by name so it can be
// chased to a real cause (a payment since the upload, a rule we have wrong).

import type { SubprojectReport } from './compute'

export interface HubProjectData {
  id: string
  name: string
  rows?: Array<{ catNum?: string; head?: string; budget?: number; woApproved?: number; actual?: number }> | null
  subRows?: Array<{ subNum?: string; head?: string; budget?: number; woApproved?: number; actual?: number }> | null
}

export type Verdict = 'exact' | 'near' | 'off' | 'only_hub' | 'only_in4'

export interface FigureDiff {
  level: 'category' | 'sub'
  code: string
  head: string
  field: 'budget' | 'woApproved' | 'actual'
  hub: number | null
  in4: number | null
  verdict: Verdict
}

export interface ProjectComparison {
  bphProjectId: string
  bphName: string
  subprojectId: number
  exact: number
  near: number
  off: number
  diffs: FigureDiff[]            // only near/off/only_* — exact matches are counted, not listed
}

export interface ComparisonSummary {
  comparedAt: string
  projects: ProjectComparison[]
  totals: { figures: number; exact: number; near: number; off: number }
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function verdictFor(hub: number, in4: number): Verdict {
  const d = Math.abs(hub - in4)
  if (d <= 1) return 'exact'
  const base = Math.max(Math.abs(hub), Math.abs(in4))
  return d / base <= 0.005 ? 'near' : 'off'
}

export function compareProject(hub: HubProjectData, in4: SubprojectReport, subprojectId: number): ProjectComparison {
  const out: ProjectComparison = { bphProjectId: hub.id, bphName: hub.name, subprojectId, exact: 0, near: 0, off: 0, diffs: [] }
  const fields = ['budget', 'woApproved', 'actual'] as const

  const walk = (
    level: 'category' | 'sub',
    hubRows: Array<{ code: string; head: string; budget: number; woApproved: number; actual: number }>,
    in4Rows: Array<{ code: string; head: string; budget: number; woApproved: number; actual: number }>,
  ) => {
    const h = new Map(hubRows.map(r => [r.code, r]))
    const i = new Map(in4Rows.map(r => [r.code, r]))
    for (const code of new Set([...h.keys(), ...i.keys()])) {
      const a = h.get(code), b = i.get(code)
      if (!a || !b) {
        // A line only one side has still counts as three figures, so the
        // percentage below is honest about missing rows.
        const src = (a ?? b)!
        const allZero = fields.every(f => n(src[f]) === 0)
        for (const f of fields) {
          if (allZero) { out.exact++; continue }
          out.off++
          out.diffs.push({ level, code, head: src.head, field: f, hub: a ? n(a[f]) : null, in4: b ? n(b[f]) : null, verdict: a ? 'only_hub' : 'only_in4' })
        }
        continue
      }
      for (const f of fields) {
        const v = verdictFor(n(a[f]), n(b[f]))
        if (v === 'exact') out.exact++
        else {
          if (v === 'near') out.near++; else out.off++
          out.diffs.push({ level, code, head: b.head || a.head, field: f, hub: n(a[f]), in4: n(b[f]), verdict: v })
        }
      }
    }
  }

  walk('category',
    (hub.rows ?? []).map(r => ({ code: String(r.catNum ?? ''), head: r.head ?? '', budget: n(r.budget), woApproved: n(r.woApproved), actual: n(r.actual) })),
    in4.rows.map(r => ({ code: r.catNum, head: r.head, budget: r.budget, woApproved: r.woApproved, actual: r.actual })))
  walk('sub',
    (hub.subRows ?? []).map(r => ({ code: String(r.subNum ?? ''), head: r.head ?? '', budget: n(r.budget), woApproved: n(r.woApproved), actual: n(r.actual) })),
    in4.subRows.map(r => ({ code: r.subNum, head: r.head, budget: r.budget, woApproved: r.woApproved, actual: r.actual })))

  // Biggest differences first — that is where the rule (or the world) changed.
  out.diffs.sort((p, q) => Math.abs((q.hub ?? 0) - (q.in4 ?? 0)) - Math.abs((p.hub ?? 0) - (p.in4 ?? 0)))
  return out
}

export function summarise(projects: ProjectComparison[], comparedAt = new Date().toISOString()): ComparisonSummary {
  const totals = projects.reduce((t, p) => ({ figures: t.figures + p.exact + p.near + p.off, exact: t.exact + p.exact, near: t.near + p.near, off: t.off + p.off }), { figures: 0, exact: 0, near: 0, off: 0 })
  return { comparedAt, projects: projects.sort((a, b) => b.off - a.off || b.near - a.near), totals }
}
