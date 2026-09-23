// What a working sheet's code becomes when the sheet is re-filed under a
// different sub-skill.
//
// ws_code is unique across the whole table and people read it — A-801-B01 says
// "NGH A, sub-skill 801, baseline 1" at a glance. A sheet that moves to 804 and
// keeps 801 in its code is a small lie that outlives the move, so the code
// follows the sheet.
//
// Pure, so the naming rule is testable without a database. The caller checks
// each candidate against the unique index and takes the first one free.

/** The code a sheet SHOULD have under its new sub-skill. Swaps the old code
 *  where it appears (A-801-B01 → A-804-B01); prefixes where it does not, so a
 *  hand-typed code like "Kitchen-rev2" still ends up under the new sub-skill
 *  rather than silently keeping a name that points somewhere else. */
export function recodeWs(current: string, fromCode: string, toCode: string): string {
  const c = current.trim()
  if (!c) return toCode
  if (!fromCode || fromCode === toCode) return c
  return c.includes(fromCode) ? c.replace(fromCode, toCode) : `${toCode}-${c}`
}

/**
 * The codes to try, in order, when the first choice is already taken.
 *
 * Collisions are real: re-import, a second baseline, or a sheet moved back and
 * forth. Rather than fail the move on a unique-index error the caller cannot
 * explain, walk a short sequence and then fall back to something that cannot
 * collide. `now` is a parameter so the last resort is testable.
 */
export function wsCodeCandidates(base: string, tries = 8, now = Date.now()): string[] {
  const list = [base, ...Array.from({ length: Math.max(0, tries) }, (_, i) => `${base}-${i + 2}`)]
  list.push(`${base}-${now.toString(36).slice(-6).toUpperCase()}`)
  return list
}
