import type { SupabaseClient } from '@supabase/supabase-js'

/** What Bills Approval does not show.
 *
 *  Aksha, 14 Sep 2026: keep Design and Professional Consultancy sub-projects
 *  out of this section entirely. They are consultant and design fees, not
 *  construction bills, and mixing them into "money waiting" makes the figure
 *  answer a question nobody asked.
 *
 *  It removes 38 of IN4's 128 sub-projects, 1,327 certificates and ₹55,60,669
 *  of open money — so the headline on every screen moves, and deliberately.
 *
 *  One gotcha this has to survive: IN4 has a sub-project called
 *  "Old Swadhyay Hall - ⁠Design" with a word-joiner (U+2060) sitting between
 *  the dash and the word. It is invisible, it came from a paste, and it is why
 *  the match strips anything that is not a letter before comparing rather than
 *  trusting the string as typed. */

/** Strip zero-width and other format characters, collapse whitespace, lower.
 *  U+200B-U+200D, U+2060 and U+FEFF all render as nothing and all appear in
 *  names that were pasted from a document. */
const normalise = (s: string): string =>
  s.replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** Word stems that put a sub-project out of scope. Matched on the normalised
 *  name, so "Design Admin", "NGH B-Design" and "- ⁠Design" all land. */
const OUT = ['design', 'professional']

export function isOutOfScope(subprojectName: string | null | undefined): boolean {
  if (!subprojectName) return false
  const n = normalise(subprojectName)
  return OUT.some(w => n.includes(w))
}

/** The sub-project ids to leave out, read once per page.
 *
 *  Returned as a Set of ids rather than applied as a query filter because the
 *  certificate tables are read in pages of 1,000 and a `not in (38 ids)` on
 *  every page is both slower and easy to forget on one of them. Filtering in
 *  one place after the read is harder to get half-right. */
export async function loadOutOfScope(sb: SupabaseClient): Promise<Set<number>> {
  const { data, error } = await sb.from('in4_subprojects').select('id, name')
  if (error) return new Set()   // never hide everything because a lookup failed
  const out = new Set<number>()
  for (const r of data ?? []) {
    if (isOutOfScope(r.name as string | null)) out.add(r.id as number)
  }
  return out
}

/** True when a row belongs to a sub-project this section does not show. */
export const rowOutOfScope = (excluded: Set<number>, subprojectId: number | null | undefined): boolean =>
  subprojectId != null && excluded.has(subprojectId)

/** The one line every screen prints, so the number is never silently narrower
 *  than it looks. */
export const SCOPE_NOTE =
  'Design and Professional Consultancy sub-projects are not included in this section.'
