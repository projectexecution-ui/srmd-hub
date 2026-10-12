// Fetch and shape what the project-first Bills home needs (see project-views.ts).
// IN4's sub-project and main-project names, the team on each sub-project's
// desks, and where the viewer has a named seat. Read-only.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillsMe } from './access'
import type { Register } from './load-register'
import { vendorOf } from './load-register'
import { isTerminal } from './stages'
import { buildProjectViews, type MainNode, type ViewBill, type TeamSeat, type SubRef, type MainRef } from './project-views'

type Seat = { desk: string; project_id: string | null; in4_subproject_id: number | null; user_id: string }

export async function loadProjectViews(sb: SupabaseClient, reg: Register, me: BillsMe): Promise<MainNode[]> {
  const live = reg.raw.filter(r => !isTerminal(r.current_stage) && !r.is_example)
  if (!live.length) return []
  const mineById = new Map(reg.rows.map(r => [r.id, r.mine]))

  const subIds = [...new Set(live.map(r => r.in4_subproject_id).filter((v): v is number => v != null))]
  const hubIds = [...new Set(live.map(r => r.project_id).filter((v): v is string => !!v))]

  const [{ data: subRows }, { data: seats }, { data: desks }, { data: heads }] = await Promise.all([
    subIds.length ? sb.from('in4_subprojects').select('id, name, project_id').in('id', subIds) : Promise.resolve({ data: [] }),
    sb.from('bb_desk_members').select('desk, project_id, in4_subproject_id, user_id'),
    subIds.length ? sb.from('bb_project_desks').select('subproject_id, atm_head_id, cc_project_id').in('subproject_id', subIds) : Promise.resolve({ data: [] }),
    hubIds.length ? sb.from('cc_project_approvers').select('project_id, user_id').eq('role', 'head').in('project_id', hubIds) : Promise.resolve({ data: [] }),
  ])
  const subs = new Map<number, SubRef>(((subRows ?? []) as Array<{ id: number; name: string | null; project_id: number | null }>)
    .map(s => [s.id, { id: s.id, name: s.name ?? `Sub-project ${s.id}`, projectId: s.project_id }]))
  const mainIds = [...new Set([...subs.values()].map(s => s.projectId).filter((v): v is number => v != null))]
  const { data: mainRows } = mainIds.length
    ? await sb.from('in4_projects').select('id, name').in('id', mainIds)
    : { data: [] }
  const mains = new Map<number, MainRef>(((mainRows ?? []) as Array<{ id: number; name: string | null }>)
    .map(m => [m.id, { id: m.id, name: m.name ?? `Project ${m.id}` }]))

  // Names for everyone on a desk.
  const seatRows = (seats ?? []) as Seat[]
  const people = [...new Set([
    ...seatRows.map(s => s.user_id),
    ...((desks ?? []) as Array<{ atm_head_id: string | null }>).map(d => d.atm_head_id).filter((v): v is string => !!v),
    ...((heads ?? []) as Array<{ user_id: string }>).map(h => h.user_id),
  ])]
  const nameOf = new Map(reg.nameOf)
  const missing = people.filter(p => !nameOf.has(p))
  if (missing.length) {
    const { data: ps } = await sb.from('profiles').select('id, full_name, email').in('id', missing)
    for (const p of ps ?? []) nameOf.set(p.id as string, (p.full_name || p.email) as string)
  }
  const names = (ids: string[]) => [...new Set(ids.map(i => nameOf.get(i)).filter((n): n is string => !!n))]

  // A desk resolves the way bb_desk_members_for does: the sub-project's own
  // seat, else the CT project's, else the global one.
  const deskFor = (desk: string, sid: number | null, pid: string | null): string[] => {
    const at = (f: (s: Seat) => boolean) => seatRows.filter(s => s.desk === desk && f(s)).map(s => s.user_id)
    const own = sid != null ? at(s => s.in4_subproject_id === sid) : []
    if (own.length) return own
    const proj = pid ? at(s => s.project_id === pid) : []
    if (proj.length) return proj
    return at(s => s.project_id == null && s.in4_subproject_id == null)
  }
  const deskBySub = new Map(((desks ?? []) as Array<{ subproject_id: number; atm_head_id: string | null; cc_project_id: string | null }>)
    .map(d => [d.subproject_id, d]))
  const headsOf = new Map<string, string[]>()
  for (const h of (heads ?? []) as Array<{ project_id: string; user_id: string }>) {
    headsOf.set(h.project_id, [...(headsOf.get(h.project_id) ?? []), h.user_id])
  }

  const teams = new Map<string, TeamSeat[]>()
  for (const r of live) {
    const key = r.in4_subproject_id != null && subs.has(r.in4_subproject_id) ? `s:${r.in4_subproject_id}` : r.project_id ? `h:${r.project_id}` : 'none'
    if (teams.has(key)) continue
    const sid = r.in4_subproject_id
    const pid = r.project_id ?? (sid != null ? deskBySub.get(sid)?.cc_project_id ?? null : null)
    const civil = names(deskFor('disc_head_civil', sid, pid))
    const mep = names(deskFor('disc_head_mep', sid, pid))
    const atmDesk = sid != null ? deskBySub.get(sid)?.atm_head_id : null
    const atm = names(atmDesk ? [atmDesk] : pid ? headsOf.get(pid) ?? [] : [])
    const seatsOut: TeamSeat[] = [
      { label: 'Disc Head', names: [...civil.map(n => `${n} (Civil)`), ...mep.map(n => `${n} (MEP)`)] },
      { label: 'CT Head', names: names(deskFor('ct_head', sid, pid)) },
      { label: 'CT Billing', names: names(deskFor('ct_billing', sid, pid)) },
      { label: 'Atm Head', names: atm },
    ]
    teams.set(key, seatsOut)
  }

  const bills: ViewBill[] = live.map(r => ({
    id: r.id,
    vendor: vendorOf(r),
    billNo: r.bill_no,
    orderType: r.order_type,
    orderNo: r.order_no,
    amount: Number(r.net_amount ?? r.claimed_amount ?? 0),
    stage: r.current_stage,
    stageSince: r.stage_since,
    subprojectId: r.in4_subproject_id != null && subs.has(r.in4_subproject_id) ? r.in4_subproject_id : null,
    hubProjectId: r.project_id,
    holders: (reg.memberIds.get(reg.deskKey(r)) ?? []).map(i => nameOf.get(i)).filter((n): n is string => !!n),
    mine: mineById.get(r.id) ?? false,
    isExample: r.is_example,
  }))

  const hubProjects = new Map<string, { name: string; parentName: string | null }>()
  for (const [id, p] of reg.projects) {
    const parent = p.parent ? reg.projects.get(p.parent) : undefined
    hubProjects.set(id, { name: p.name, parentName: parent?.name ?? null })
  }

  return buildProjectViews({
    bills, subs, mains, hubProjects,
    mySubs: new Set([...me.desks.map(d => d.subprojectId).filter((v): v is number => v != null), ...me.atmSubprojects]),
    myHubProjects: new Set([...me.desks.map(d => d.projectId).filter((v): v is string => !!v), ...me.atmProjects]),
    teams,
    now: Date.now(),
  })
}
