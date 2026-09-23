// IN4 → hub intake: the pure part.
//
// Aksha, 23 Sep 2026 (N1 + NS4): "when i make a new project in In4 - it
// automatically comes to Internal Estimate", and for the 67 already waiting,
// "give the flexibility to select the project - to admin and parimal as
// well". So:
//
//   • The twice-daily masters feed records every active IN4 sub-project the
//     hub does not hold as an ARRIVAL (in4_hub_intake, status 'new').
//   • An arrival that is Execution work is adopted at once by the sync — a
//     hub project marked "Not finished", under the group for its IN4 project,
//     linked so Budget (ERP) flows on the next run. Design, consultancy,
//     trusts and the like wait to be chosen.
//   • The backlog waiting on the day this shipped is never adopted blindly:
//     it sits on Data › From IN4 where an admin or Parimal ticks what comes in.
//
// Everything that decides is here and tested; intake.server.ts only reads
// and writes.

export type IntakeKind = 'execution' | 'design' | 'consultancy' | 'other'

export const INTAKE_KIND_LABEL: Record<IntakeKind, string> = {
  execution: 'Execution',
  design: 'Design',
  consultancy: 'Consultancy',
  other: 'Other',
}

/** What an IN4 sub-project is, read off its name — IN4 keeps no type column,
 *  and its naming is regular: "<building> - Execution", "… - Design",
 *  "… - Professional Consultancy". */
export function classifySubproject(name: string): IntakeKind {
  const n = name.toLowerCase()
  if (/professional consultancy|consultan/.test(n)) return 'consultancy'
  if (/\bdesign\b/.test(n)) return 'design'
  if (/\btrust\b|fixed assets|common expenses|bhoomi|professional/.test(n)) return 'other'
  return 'execution'
}

/** Only Execution arrives on its own; the rest waits to be chosen. */
export function autoAdopts(kind: IntakeKind): boolean {
  return kind === 'execution'
}

/** A short code from a name: initials of the words, upper-case, unique among
 *  what exists. "Old Swadhyay Hall - Execution" → OSH; a clash → OSH2. */
export function proposeCode(name: string, taken: ReadonlySet<string>): string {
  const base = name.split(/\s*-\s*/)[0]                 // drop " - Execution"
  const words = base.split(/[^A-Za-z0-9]+/).filter(Boolean)
  let code = words.length >= 2
    ? words.map(w => w[0]).join('').toUpperCase()
    : (words[0] ?? 'PRJ').slice(0, 4).toUpperCase()
  if (code.length < 2) code = (words[0] ?? 'PRJ').slice(0, 3).toUpperCase()
  return uniqueCode(code, taken)
}

/** `code`, or `code2`, `code3`… — whichever is free (case-insensitive). */
export function uniqueCode(code: string, taken: ReadonlySet<string>): string {
  const norm = (s: string) => s.trim().toUpperCase()
  const has = (c: string) => [...taken].some(t => norm(t) === c)
  if (!has(code)) return code
  for (let i = 2; i < 100; i++) if (!has(`${code}${i}`)) return `${code}${i}`
  return `${code}${Date.now() % 1000}`
}

/** A group's code ends in G, the way the hub's own anchors do (NGHG, P2G,
 *  VVG, RUG), so it can never collide with the building's own code. */
export function groupCodeFor(in4ProjectName: string, taken: ReadonlySet<string>): string {
  return uniqueCode(proposeCode(in4ProjectName, new Set()) + 'G', taken)
}

/** "Old Swadhyay Hall - Execution" stays as it is — IN4's name is the one the
 *  team knows, and the alias table matches on it. */
export function hubNameFor(spName: string): string {
  return spName.replace(/\s{2,}/g, ' ').trim()
}

export interface IntakeRowIn {
  subprojectId: number
  name: string
  in4ProjectId: number
  in4ProjectName: string
  areaFt: number | null
  budget: number | null
  firstSeenAt: string
}

export interface IntakePlan {
  subprojectId: number
  name: string
  code: string
  kind: IntakeKind
  /** The hub group to sit under: an existing one, or a new one to create. */
  parent: { id: string } | { create: { name: string; code: string } }
}

/** Where a sub-project's hub project goes. The group for its IN4 project if
 *  the hub already has one (a sibling is linked under it); else a new group
 *  named after the IN4 project. Codes are unique across everything passed. */
export function planIntake(
  rows: readonly IntakeRowIn[],
  ctx: {
    /** IN4 project id → hub group id, where a sibling already lives under a group. */
    groupByIn4Project: ReadonlyMap<number, string>
    takenCodes: ReadonlySet<string>
  },
): IntakePlan[] {
  const taken = new Set(ctx.takenCodes)
  const newGroups = new Map<number, { name: string; code: string }>()
  return rows.map(r => {
    const code = proposeCode(r.name, taken); taken.add(code)
    let parent: IntakePlan['parent']
    const existing = ctx.groupByIn4Project.get(r.in4ProjectId)
    if (existing) parent = { id: existing }
    else {
      let g = newGroups.get(r.in4ProjectId)
      if (!g) {
        const gcode = groupCodeFor(r.in4ProjectName, taken); taken.add(gcode)
        g = { name: r.in4ProjectName.trim(), code: gcode }
        newGroups.set(r.in4ProjectId, g)
      }
      parent = { create: g }
    }
    return { subprojectId: r.subprojectId, name: hubNameFor(r.name), code, kind: classifySubproject(r.name), parent }
  })
}

/** The Budget-Hub entry a hub project needs so IN4 figures can land — the
 *  three-hop chain IN4 sub-project → BPH project → hub project. The id is
 *  deliberately unlike the base-36 ids the /budget UI mints, so an undo can
 *  find every one of these. */
export function bphEntryFor(subprojectId: number, name: string, nowMs: number) {
  return { id: `ctin4${subprojectId}`, name, type: 'project', data: null, location: '', parentId: null, createdAt: nowMs, areaStatement: null }
}

/** Words for the Today strip. */
export function intakeWords(i: { waiting: number; arrivedRecently: number }): { waiting: string | null; arrived: string | null } {
  return {
    waiting: i.waiting > 0 ? `${i.waiting} IN4 sub-project${i.waiting === 1 ? ' is' : 's are'} not in the hub — choose which come in.` : null,
    arrived: i.arrivedRecently > 0 ? `${i.arrivedRecently} new IN4 project${i.arrivedRecently === 1 ? '' : 's'} arrived from the sync and need${i.arrivedRecently === 1 ? 's' : ''} finishing — an Atm Head and categories.` : null,
  }
}
