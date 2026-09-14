/** Where a bill books, worked out rather than asked.
 *
 *  Aksha, 14 Sep 2026: "this whole section can be mapped automatically — why
 *  give typing, rather pull data from WO and PO itself as it carries all those
 *  data."
 *
 *  He is right, and the numbers say how right. Of the 1,685 work orders that
 *  carry a number, every single one names its IN4 sub-project, every single one
 *  names its category, and 2,176 of 2,181 carry a work description. Nothing on
 *  the old step 4 was information the entry clerk had and the system didn't.
 *
 *  So this resolves four things off the work order:
 *
 *    the sub-project  — in4_work_orders.subproject_id, always present
 *    the CT Hub project — through IN4's own subproject link chain
 *    who approves it  — the desk's Atm Head, or the project's head
 *    the category     — the WO's IN4 skill, matched to a CT Hub discipline
 *
 *  Two of those can come up empty, and both are normal rather than broken:
 *
 *  CT Hub has 45 projects; IN4 has 54 sub-projects with numbered work orders,
 *  and 22 of them reach a live CT Hub project — 341 of the 1,228 work orders.
 *  The other 32 include Staff Facilities Block (149 work orders), Raj Uphaar
 *  (136), RU Infra Work (112) and Raj Saurabh (90) — most of the money. They
 *  are not mis-mapped: CT Hub has no project for those buildings at all,
 *  because Cost Control covers a subset of the ashram. Making the
 *  clerk choose from a list that does not contain the right answer produces a
 *  wrong answer. So Bills Approval keeps its own desk for a sub-project, and an
 *  admin sets it once — that is `bb_project_desks`.
 *
 *  And the CT Hub discipline list is IN4's skill list with the sort number
 *  dropped: "12 Finishes" against "Finishes", typos and all ("Temporary Acess
 *  Road" appears in both). Dropping a leading number is reading IN4's
 *  convention, not guessing at a name — it lands 1,551 of 1,685 work orders.
 *  The 134 it does not (Creche Area, Raj Kruti, Interior Area Exp Under RU
 *  Management) keep IN4's own category name as text, which beats an empty box.
 */

export interface Person { id: string; name: string }
export interface CtProject { id: string; code: string | null; name: string }
export interface Discipline { id: string; name: string }

export interface DeskRow {
  subproject_id: number
  in4_name: string | null
  cc_project_id: string | null
  atm_head_id: string | null
  note: string | null
}

export interface BookingMaps {
  /** IN4 sub-project id → its name. */
  subprojects: Map<number, string>
  /** IN4 sub-project id → CT Hub project, through in4_subproject_links →
   *  cc_bph_project_links → projects. IN4's own mapping, never a name match. */
  linked: Map<number, CtProject>
  /** What an admin has set for a sub-project inside Bills Approval. */
  desks: Map<number, DeskRow>
  /** CT Hub project id → the people already carrying `head` on it in Cost
   *  Control, so a project that has an Atm Head does not need one re-entered. */
  projectHeads: Map<string, Person[]>
  people: Map<string, Person>
  ctProjects: Map<string, CtProject>
  /** IN4 skill id → name, e.g. 46 → "12 Finishes". */
  skills: Map<number, string>
  /** CT Hub discipline, keyed on its lowercased name. */
  disciplines: Map<string, Discipline>
}

export interface Booking {
  subprojectId: number | null
  subprojectName: string | null
  /** The CT Hub project, when one exists. Null is normal — see the note above. */
  projectId: string | null
  projectName: string | null
  /** `in4` when IN4's own link produced it, `desk` when an admin pointed the
   *  desk at a project by hand. Shown, so nobody has to wonder which. */
  projectSource: 'in4' | 'desk' | null
  /** Who sanctions bills here. More than one is possible and is not resolved
   *  down to a guess — the screen lists them. */
  atmHeads: Person[]
  atmSource: 'desk' | 'project' | null
  /** True once an admin has set a desk for this sub-project. */
  hasDesk: boolean
  /** IN4's own category, always present: "19 Site Admin". */
  categoryIn4: string | null
  /** The matching CT Hub discipline, when the names agree once the sort number
   *  is dropped. */
  disciplineId: string | null
  disciplineName: string | null
  /** ENGG_WORK_ORDER.WORK_DESCRIPTION — the scope, in the engineer's words. */
  scope: string | null
}

/** What the resolver is given about a work order. Deliberately the smallest
 *  shape, so the picker, the form and the tests all speak the same language. */
export interface BookableWo {
  subprojectId: number | null
  categoryId: number | null
  workDescription: string | null
}

/** IN4 prefixes every skill with its sort number: "12 Finishes", "03 Civil".
 *  CT Hub's discipline list is the same names without it. */
export const stripSkillNumber = (name: string): string =>
  name.replace(/^\s*\d+\s+/, '').trim()

const EMPTY: Booking = {
  subprojectId: null, subprojectName: null,
  projectId: null, projectName: null, projectSource: null,
  atmHeads: [], atmSource: null, hasDesk: false,
  categoryIn4: null, disciplineId: null, disciplineName: null, scope: null,
}

export function resolveBooking(wo: BookableWo | null, m: BookingMaps): Booking {
  if (!wo) return { ...EMPTY }

  const sid = wo.subprojectId
  const desk = sid == null ? undefined : m.desks.get(sid)
  const linked = sid == null ? undefined : m.linked.get(sid)

  // IN4's link wins over the desk: the desk exists to fill a gap, not to
  // override the ERP. When both point somewhere, they should agree, and if
  // they ever don't, the ERP is the one the Billing team keys against.
  const deskProject = desk?.cc_project_id ? m.ctProjects.get(desk.cc_project_id) : undefined
  const project = linked ?? deskProject ?? null
  const projectSource: Booking['projectSource'] = linked ? 'in4' : deskProject ? 'desk' : null

  // An Atm Head named on the desk beats one inherited from Cost Control —
  // somebody chose it for bills specifically.
  const deskHead = desk?.atm_head_id ? m.people.get(desk.atm_head_id) : undefined
  const projectHeads = project ? (m.projectHeads.get(project.id) ?? []) : []
  const atmHeads = deskHead ? [deskHead] : projectHeads
  const atmSource: Booking['atmSource'] = deskHead ? 'desk' : projectHeads.length ? 'project' : null

  const categoryIn4 = wo.categoryId == null ? null : (m.skills.get(wo.categoryId) ?? null)
  const disc = categoryIn4 ? m.disciplines.get(stripSkillNumber(categoryIn4).toLowerCase()) : undefined

  return {
    subprojectId: sid,
    subprojectName: sid == null ? null : (m.subprojects.get(sid) ?? desk?.in4_name ?? null),
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    projectSource,
    atmHeads,
    atmSource,
    hasDesk: !!desk,
    categoryIn4,
    disciplineId: disc?.id ?? null,
    disciplineName: disc?.name ?? null,
    scope: wo.workDescription?.trim() || null,
  }
}

/** What still has to be answered by a person before this bill can move.
 *
 *  Never used to disable the button. A bill that cannot reach an Atm desk is
 *  still a bill that arrived, and burying it is how the section starts lying
 *  about what is outstanding — it is entered, and the gap is shown. */
export function bookingGaps(b: Booking): string[] {
  const gaps: string[] = []
  if (!b.projectId) gaps.push('no CT Hub project')
  if (!b.atmHeads.length) gaps.push('no Atm Head')
  return gaps
}
