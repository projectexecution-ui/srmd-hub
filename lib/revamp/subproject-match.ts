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
 *  "SRMD Ashram ICT Team" is stripped before "Team" could ever be.
 *
 *  "Infra Work" is deliberately NOT here. Aksha confirmed (2026-08-31) that
 *  Infra is a SEPARATE PROJECT, not a stage of the building it is named after:
 *  P2 Row Houses, its Infra, and its Common Expenses are three different
 *  projects in one group. Treating it as a stage would strip
 *  "Raj Uphaar - Infra Work" down to "Raj Uphaar" and merge ₹9.98 Cr into the
 *  wrong project. Same reasoning for MEP Infra. */
export const STAGE_SUFFIXES = [
  'SRMD Ashram Security Team',
  'SRMD Ashram ICT Team',
  'Professional Consultancy',
  'Common Expenses',
  'Interior Scope',
  'SRMD Landscape',
  'Bhoomi Pujan',
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
  /** How it was matched — so the review screen can show automatic matches
   *  separately from ones that rest on a stated alias. */
  via: 'name' | 'code' | 'alias' | null
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
  /** Stated IN4-name → hub-name/code aliases. See alias-seed.ts. Optional, so
   *  the pure matching rule can still be tested on its own. */
  aliases: Array<{ in4: string; hub: string }> = [],
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

  // An alias resolves to a project id via the hub's own name or code, so a
  // typo'd alias target simply fails to resolve rather than matching nothing
  // silently or, worse, something wrong.
  const byAlias = new Map<string, string>()
  for (const a of aliases) {
    const target = byName.get(key(a.hub)) ?? byCode.get(key(a.hub))
    if (target) byAlias.set(key(a.in4), target)
  }

  return subProjectNames.map(raw => {
    const cleaned = clean(raw)
    const { base, stage } = splitSubProject(cleaned)

    // Aliases are checked on the FULL name first: some of them are only
    // distinguishable before the stage is stripped, e.g. "P2 Stepped Terraces
    // - Execution A-01" is the A01 tower while the bare base is not.
    let projectId: string | null = null
    let via: SubProjectMatch['via'] = null

    const tryIn = (m: Map<string, string>, k: string, how: SubProjectMatch['via']) => {
      if (projectId) return
      const hit = m.get(k)
      if (hit) { projectId = hit; via = how }
    }

    tryIn(byAlias, key(cleaned), 'alias')
    tryIn(byName,  key(cleaned), 'name')
    tryIn(byAlias, key(base),    'alias')
    tryIn(byName,  key(base),    'name')
    tryIn(byCode,  key(base),    'code')

    return { subProjectName: cleaned, base, stage, projectId, via }
  })
}

/** Every sub-project that belongs to one hub project, whatever its stage. */
export function subProjectsFor(matches: SubProjectMatch[], projectId: string): string[] {
  return matches.filter(m => m.projectId === projectId).map(m => m.subProjectName)
}
