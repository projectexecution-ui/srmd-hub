// Merge IN4's two reports into one complete, priced picture.
//
// The two exports are complementary and neither is complete on its own:
//   • PO report (flat)      → authoritative for anything with a PO: accurate
//     PO qty, PO rate + amount, received & balance qty, invoice. This is the
//     only report that carries pricing.
//   • Indent-to-Issue (banded) → the only report that lists indents with NO PO
//     yet (the "Needs PO" gap) — but it has no PO price column and drops some
//     PO quantities.
//
// Strategy = a DATA-LOSS-SAFE UNION, keyed by (indentNo + material):
//   1. Take every PO-report line (priced, accurate).
//   2. Add every indent-report line the PO report does NOT already cover.
// So an item in both keeps the PO report's priced version (no double-count),
// while anything the PO report omits — e.g. because it's a filtered export, or
// the item has no PO yet — is preserved from the indent report. Nothing is
// ever lost; you just gain pricing wherever the PO report reaches.

import type { LineRecord, ProjectSummary } from './types'
import { buildProjectSummaries } from './rollup'

// Loose key: same indent + same material, tolerant of spacing/punctuation
// differences between the two parsers' material cleaning.
function lineKey(l: LineRecord): string {
  const mat = (l.material || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${(l.indentNo || '').toLowerCase()}¦${mat}`
}

export function mergeReports(
  poProjects: ProjectSummary[] | null | undefined,
  indentProjects: ProjectSummary[] | null | undefined,
): ProjectSummary[] {
  const po = poProjects ?? []
  const indent = indentProjects ?? []
  if (po.length === 0) return indent
  if (indent.length === 0) return po

  const poLines = po.flatMap(p => p.lines)
  const covered = new Set(poLines.map(lineKey))
  const indentExtra = indent.flatMap(p => p.lines).filter(l => !covered.has(lineKey(l)))

  return buildProjectSummaries([...poLines, ...indentExtra])
}
