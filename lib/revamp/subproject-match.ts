// Matching IN4 sub-project names onto CT Hub projects — "Problem 3".
//
// The contractor and supplier reports are Project → SUB-PROJECT → Category →
// Party. Two traps, both found the hard way:
//
//   1. The report's top-level "project" is an IN4 GROUPING, not a project.
//      "Raj Uphaar" contains Raj Saurabh (₹13.9 Cr) and Common Facility Block
//      (₹11.4 Cr). Matching at report level would misattribute ~₹25 Cr.
//      So we ALWAYS match at sub-project level.
//   2. Only 7 of 112 sub-project names match a hub project outright, because
//      the sub-project is really "<Project> <Stage>".
//
// THE RULE (agreed with Aksha): the BASE NAME decides the project; the stage
// is only a suffix. Strip the stage, match the base.
//
// Anything that does not match is NOT dropped and NOT guessed — it is returned
// as unmatched so the screen can show the money sitting in a holding list.
// That is what makes this self-healing: the day a missing project is created,
// its money attaches on the next read with no map to maintain.

/** Stage suffixes seen in the real exports. Order matters — longest first, so
 *  "SRMD Ashram ICT Team" is stripped before "Team" could ever be. */
export const STAGE_SUFFIXES = [
  'SRMD Ashram Security Team',
  'SRMD Ashram ICT Team',
  'Professional Consultancy',
  'Common Expenses',
  'Interior Scope',
  'SRMD Landscape',
  'Bhoomi Pujan',
  'Infra Work',
  'Execution',
  'Design',
] as const

/** Strip zero-width and other non-printing characters. Real sub-project names
 *  contain them (e.g. "Old Swadhyay Hall - ⁠Design") and they silently break
 *  every text comparison. */
export function clean(s: string): string {
  return (s ?? '')
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Comparison key: case and punctuation differ between IN4 and the hub. */
export function key(s: string): string {
  return clean(s).toLowerCase().replace(/[^a-z0-9]/g, '')
}

export interface SplitName {
  base: string
  stage: string | null
}

/**
 * Split "Vinay Vivek Infra - Execution" → { base: "Vinay Vivek Infra",
 * stage: "Execution" }. Handles both separator styles seen in the exports:
 * "<Base> - <Stage>" and "<Base> <Stage>" (e.g. "Vinay Vivek Common Expenses").
 */
export function splitSubProject(name: string): SplitName {
  const c = clean(name)
  for (const stage of STAGE_SUFFIXES) {
    // "<Base> - <Stage>"
    const dashed = new RegExp(`\\s*[-–—]\\s*${escapeRe(stage)}$`, 'i')
    if (dashed.test(c)) return { base: clean(c.replace(dashed, '')), stage }
    // "<Base> <Stage>" — only when something is left, so a sub-project that IS
    // just the stage name keeps its own name rather than becoming empty.
    const bare = new RegExp(`\\s+${escapeRe(stage)}$`, 'i')
    if (bare.test(c)) {
      const base = clean(c.replace(bare, ''))
      if (base) return { base, stage }
    }
  }
  return { base: c, stage: null }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface HubProject {
  id: string
  code: string | null
  name: string
}

export interface SubProjectMatch {
  subProjectName: string
  base: string
  stage: string | null
  projectId: string | null
}

/**
 * Match sub-project names onto hub projects by base name.
 *
 * Tries, in order: the full cleaned name, then the base with the stage
 * stripped, then the base against the project CODE. First hit wins; no fuzzy
 * matching, because a wrong match moves real money onto the wrong project and
 * is worse than no match at all.
 */
export function matchSubProjects(
  subProjectNames: string[],
  projects: HubProject[],
): SubProjectMatch[] {
  const byName = new Map<string, string>()
  const byCode = new Map<string, string>()
  for (const p of projects) {
    const k = key(p.name)
    if (k && !byName.has(k)) byName.set(k, p.id)
    if (p.code) {
      const c = key(p.code)
      if (c && !byCode.has(c)) byCode.set(c, p.id)
    }
  }

  return subProjectNames.map(raw => {
    const { base, stage } = splitSubProject(raw)
    const projectId =
      byName.get(key(clean(raw)))
      ?? byName.get(key(base))
      ?? byCode.get(key(base))
      ?? null
    return { subProjectName: clean(raw), base, stage, projectId }
  })
}

/** Every sub-project that belongs to one hub project, whatever its stage. */
export function subProjectsFor(matches: SubProjectMatch[], projectId: string): string[] {
  return matches.filter(m => m.projectId === projectId).map(m => m.subProjectName)
}
