// What a project still needs before it can work — the "Not finished" strip on
// Setup (Aksha, 23 Sep 2026, P1) and the same list the Projects door counts.
//
// A project used to read "100 % complete" the moment its categories were
// ticked, while having no Atm Head (so a budget on it mailed every head), no
// area (so ₹/sft was blank) and no IN4 link (so Budget (ERP) stayed empty).
// The 20 RU sub-projects brought in on 21 Sep were all three. This is the one
// definition of finished, pure so it is tested.

import type { ProjectKind } from '@/lib/projects/kind'

export interface SetupFacts {
  kind: ProjectKind
  atmHeads: number
  areaSft: number | null
  /** Linked to at least one IN4 sub-project (the BPH → IN4 chain). */
  in4Linked: boolean
  /** Whether the IN4 link matters at all — the BPH sync setting. */
  in4Available: boolean
  disciplines: number
  subSkills: number
}

export type SetupBlock = 'basics' | 'people' | 'categories'

export interface SetupGap {
  key: 'head' | 'area' | 'in4' | 'categories' | 'subskills'
  /** Short, for the chip. */
  label: string
  /** The consequence, for the tooltip and the Today strip. */
  why: string
  block: SetupBlock
}

/** Everything still missing, in the order the page shows its blocks. A group
 *  has no people or categories of its own, so it can never be unfinished. */
export function setupGaps(f: SetupFacts): SetupGap[] {
  if (f.kind === 'group') return []
  const out: SetupGap[] = []
  if (!(f.areaSft && f.areaSft > 0)) out.push({ key: 'area', label: 'No area', why: '₹/sft is blank on every figure', block: 'basics' })
  if (f.in4Available && !f.in4Linked) out.push({ key: 'in4', label: 'Not linked to IN4', why: 'Budget (ERP), WO / PO and Paid stay empty', block: 'basics' })
  if (f.atmHeads === 0) out.push({ key: 'head', label: 'No Atm Head', why: 'a budget raised here would mail every Atm Head', block: 'people' })
  if (f.disciplines === 0) out.push({ key: 'categories', label: 'No work categories', why: 'nothing can be estimated or requested', block: 'categories' })
  else if (f.subSkills === 0) out.push({ key: 'subskills', label: 'No sub-skills', why: 'every category is an empty box', block: 'categories' })
  return out
}

export function isFinished(f: SetupFacts): boolean {
  return setupGaps(f).length === 0
}

/** "Not finished — no Atm Head, no area" for a strip or a list row. */
export function gapsSentence(gaps: readonly SetupGap[]): string {
  if (gaps.length === 0) return 'Finished'
  return `Not finished — ${gaps.map(g => g.label.toLowerCase()).join(', ')}`
}
