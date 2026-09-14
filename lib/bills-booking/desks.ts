import type { SupabaseClient } from '@supabase/supabase-js'
import { stripSkillNumber, type BookingMaps, type CtProject, type DeskRow, type Person } from './booking'
import { isOutOfScope } from './scope'

/** Reading the mapping, and the screen that fills its gaps.
 *
 *  Two jobs, one file, because they read the same six tables and it would be
 *  silly for the entry form and the desks screen to disagree about what maps.
 *
 *  The chain that produces a CT Hub project is IN4's own, in three hops:
 *
 *    in4_subproject_links.subproject_id → bph_project_id
 *    cc_bph_project_links.bph_project_id → cc_project_id
 *    projects.id
 *
 *  It is joined at SUB-PROJECT level and never by name. IN4's top-level
 *  "project" is a grouping — "Raj Uphaar" contains Raj Saurabh and Common
 *  Facility Block — so keying on it would put crores against the wrong
 *  building. 39 links exist, 35 land on a CT Hub project, 4 dead-end on a
 *  bph_project_id nothing in CT Hub claims. */

interface LinkRow { subproject_id: number; bph_project_id: string | null }
interface BphRow { bph_project_id: string; cc_project_id: string | null }
interface ProjRow { id: string; code: string | null; name: string; archived_at: string | null }
interface ApproverRow { project_id: string; user_id: string; role: string }
interface ProfileRow { id: string; full_name: string | null; name: string | null; email: string | null }
interface SkillRow { id: number; name: string | null }
interface DiscRow { id: string; name: string }
interface SubRow { id: number; name: string | null }

/** Whatever the profile actually has — full name, then name, then the e-mail,
 *  which at least identifies a person rather than showing a blank chip. */
const personName = (p: ProfileRow): string =>
  (p.full_name?.trim() || p.name?.trim() || p.email?.trim() || 'Unnamed user')

export async function loadBookingMaps(sb: SupabaseClient): Promise<BookingMaps> {
  const [links, bph, projects, approvers, profiles, skills, discs, subs, desks] = await Promise.all([
    sb.from('in4_subproject_links').select('subproject_id, bph_project_id'),
    sb.from('cc_bph_project_links').select('bph_project_id, cc_project_id'),
    sb.from('projects').select('id, code, name, archived_at'),
    // `head` is the Atm desk in Cost Control. founder and project_head are
    // different lanes and are not bill approvers.
    sb.from('cc_project_approvers').select('project_id, user_id, role').eq('role', 'head'),
    sb.from('profiles').select('id, full_name, name, email'),
    sb.from('in4_skills').select('id, name'),
    sb.from('cc_disciplines').select('id, name').eq('is_archived', false),
    sb.from('in4_subprojects').select('id, name'),
    sb.from('bb_project_desks').select('subproject_id, in4_name, cc_project_id, atm_head_id, note'),
  ])

  const ctProjects = new Map<string, CtProject>()
  for (const p of (projects.data ?? []) as ProjRow[]) {
    if (p.archived_at) continue
    ctProjects.set(p.id, { id: p.id, code: p.code, name: p.name })
  }

  const bphToCt = new Map<string, string>()
  for (const r of (bph.data ?? []) as BphRow[]) {
    if (r.cc_project_id) bphToCt.set(r.bph_project_id, r.cc_project_id)
  }

  const linked = new Map<number, CtProject>()
  for (const l of (links.data ?? []) as LinkRow[]) {
    if (!l.bph_project_id) continue
    const ccId = bphToCt.get(l.bph_project_id)
    const proj = ccId ? ctProjects.get(ccId) : undefined
    // A link whose bph_project_id reaches nothing is left out, not carried as
    // a half-answer. Those sub-projects fall to a desk like any other.
    if (proj) linked.set(l.subproject_id, proj)
  }

  const people = new Map<string, Person>()
  for (const p of (profiles.data ?? []) as ProfileRow[]) people.set(p.id, { id: p.id, name: personName(p) })

  const projectHeads = new Map<string, Person[]>()
  for (const a of (approvers.data ?? []) as ApproverRow[]) {
    const person = people.get(a.user_id)
    if (!person) continue
    const list = projectHeads.get(a.project_id)
    if (list) list.push(person)
    else projectHeads.set(a.project_id, [person])
  }

  const disciplines = new Map<string, { id: string; name: string }>()
  for (const d of (discs.data ?? []) as DiscRow[]) {
    // Keyed on the CT Hub name lowercased; the caller strips IN4's sort number
    // before looking up, so "12 Finishes" finds "Finishes".
    disciplines.set(stripSkillNumber(d.name).toLowerCase(), { id: d.id, name: d.name })
  }

  return {
    subprojects: new Map(((subs.data ?? []) as SubRow[]).map(s => [s.id, s.name ?? ''])),
    linked,
    desks: new Map(((desks.data ?? []) as DeskRow[]).map(d => [d.subproject_id, d])),
    projectHeads,
    people,
    ctProjects,
    skills: new Map(((skills.data ?? []) as SkillRow[]).map(s => [s.id, s.name ?? ''])),
    disciplines,
  }
}

/** One row of the desks screen: an IN4 sub-project that has work orders, and
 *  whether Bills Approval knows where it books and who approves it. */
export interface DeskCoverage {
  subprojectId: number
  subprojectName: string
  /** Work orders raised against it — the size of the gap, so the list can be
   *  worked biggest-first rather than alphabetically. */
  wos: number
  projectId: string | null
  projectName: string | null
  projectSource: 'in4' | 'desk' | null
  atmHeads: Person[]
  atmSource: 'desk' | 'project' | null
  hasDesk: boolean
  note: string | null
}

/** Every in-scope sub-project that has ever had a work order, with its mapping
 *  state. Design and Professional Consultancy are dropped here exactly as they
 *  are everywhere else in the section, so the list is not padded with rows
 *  nobody will ever file a construction bill against. */
export async function loadDeskCoverage(sb: SupabaseClient): Promise<DeskCoverage[]> {
  const maps = await loadBookingMaps(sb)

  const counts = new Map<number, number>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('in4_work_orders')
      .select('subproject_id, display_no').range(from, from + 999)
    if (error) throw new Error(`in4_work_orders: ${error.message}`)
    const rows = (data ?? []) as Array<{ subproject_id: number | null; display_no: string | null }>
    for (const r of rows) {
      if (r.subproject_id == null || !r.display_no) continue
      counts.set(r.subproject_id, (counts.get(r.subproject_id) ?? 0) + 1)
    }
    if (rows.length < 1000) break
  }

  const out: DeskCoverage[] = []
  for (const [sid, wos] of counts) {
    const name = maps.subprojects.get(sid) ?? maps.desks.get(sid)?.in4_name ?? `Sub-project ${sid}`
    if (isOutOfScope(name)) continue
    const desk = maps.desks.get(sid)
    const linked = maps.linked.get(sid)
    const deskProject = desk?.cc_project_id ? maps.ctProjects.get(desk.cc_project_id) : undefined
    const project = linked ?? deskProject ?? null
    const deskHead = desk?.atm_head_id ? maps.people.get(desk.atm_head_id) : undefined
    const projectHeads = project ? (maps.projectHeads.get(project.id) ?? []) : []
    out.push({
      subprojectId: sid,
      subprojectName: name,
      wos,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      projectSource: linked ? 'in4' : deskProject ? 'desk' : null,
      atmHeads: deskHead ? [deskHead] : projectHeads,
      atmSource: deskHead ? 'desk' : projectHeads.length ? 'project' : null,
      hasDesk: !!desk,
      note: desk?.note ?? null,
    })
  }

  // Unanswered first, biggest first inside that — the point of the screen is to
  // close gaps, and 149 work orders matter more than 1.
  const open = (r: DeskCoverage) => (r.projectId ? 0 : 1) + (r.atmHeads.length ? 0 : 1)
  out.sort((a, b) => open(b) - open(a) || b.wos - a.wos)
  return out
}
