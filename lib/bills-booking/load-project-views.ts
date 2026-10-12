// Fetch and shape what the project-first Bills home needs (see project-views.ts).
// IN4's sub-project and main-project names and money, the team on each sub-
// project's desks, and where the viewer has a named seat. Read-only.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BillsMe } from './access'
import type { Register } from './load-register'
import { vendorOf } from './load-register'
import { isTerminal } from './stages'
import { sumPositions, type BuildInput, type ViewBill, type TeamSeat, type SubRef, type MainRef, type Position } from './project-views'

type Seat = { desk: string; project_id: string | null; in4_subproject_id: number | null; user_id: string }

async function paged<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown[] | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data } = await q(from, from + 999)
    const page = (data ?? []) as T[]
    out.push(...page)
    if (page.length < 1000) break
  }
  return out
}

export async function loadProjectViewInput(sb: SupabaseClient, reg: Register, me: BillsMe): Promise<BuildInput> {
  const live = reg.raw.filter(r => !isTerminal(r.current_stage) && !r.is_example)
  const mineById = new Map(reg.rows.map(r => [r.id, r.mine]))
  const empty: BuildInput = {
    bills: [], subs: new Map(), mains: new Map(), hubProjects: new Map(), mySubs: new Set(), myHubProjects: new Set(),
    teams: new Map(), now: Date.now(),
  }
  if (!live.length) return empty

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

  // The whole of each main project — every sub-project IN4 has under it — for
  // its money, not only the sub-projects with a bill pending here.
  const [{ data: mainRows }, { data: allSubRows }] = await Promise.all([
    mainIds.length ? sb.from('in4_projects').select('id, name').in('id', mainIds) : Promise.resolve({ data: [] }),
    mainIds.length ? sb.from('in4_subprojects').select('id, project_id').in('project_id', mainIds) : Promise.resolve({ data: [] }),
  ])
  const mains = new Map<number, MainRef>(((mainRows ?? []) as Array<{ id: number; name: string | null }>)
    .map(m => [m.id, { id: m.id, name: m.name ?? `Project ${m.id}` }]))
  const mainOfSub = new Map(((allSubRows ?? []) as Array<{ id: number; project_id: number }>).map(s => [s.id, s.project_id]))
  const allSubIds = [...mainOfSub.keys()]

  // IN4 money per sub-project: orders (live WOs, gross), billed and paid (WO certificates, not cancelled).
  const subPositions = new Map<number, Position>()
  const pos = (sid: number) => {
    let p = subPositions.get(sid)
    if (!p) { p = { orders: 0, woCount: 0, billed: 0, paid: 0 }; subPositions.set(sid, p) }
    return p
  }
  if (allSubIds.length) {
    const [wos, certs] = await Promise.all([
      paged<{ subproject_id: number; wo_gross_value: number | null; status_name: string | null }>((a, b) =>
        sb.from('in4_work_orders').select('subproject_id, wo_gross_value, status_name').in('subproject_id', allSubIds).range(a, b)),
      paged<{ subproject_id: number; gross_bill_amt: number | null; paid_amt: number | null; status_name: string | null }>((a, b) =>
        sb.from('in4_wo_certificates').select('subproject_id, gross_bill_amt, paid_amt, status_name')
          .eq('kind', 'wo').in('subproject_id', allSubIds).range(a, b)),
    ])
    for (const w of wos) {
      if (['cancelled', 'terminated'].includes((w.status_name ?? '').toLowerCase())) continue
      const p = pos(w.subproject_id); p.woCount += 1; p.orders += Number(w.wo_gross_value ?? 0)
    }
    for (const c of certs) {
      if ((c.status_name ?? '') === 'Cancelled') continue
      const p = pos(c.subproject_id); p.billed += Number(c.gross_bill_amt ?? 0); p.paid += Number(c.paid_amt ?? 0)
    }
  }
  const mainPositions = new Map<number, Position>()
  for (const mid of mainIds) {
    mainPositions.set(mid, sumPositions(allSubIds.filter(s => mainOfSub.get(s) === mid).map(s => subPositions.get(s)).filter((p): p is Position => !!p)))
  }

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
    teams.set(key, [
      { label: 'Disc Head', names: [...civil.map(n => `${n} (Civil)`), ...mep.map(n => `${n} (MEP)`)] },
      { label: 'CT Head', names: names(deskFor('ct_head', sid, pid)) },
      { label: 'CT Billing', names: names(deskFor('ct_billing', sid, pid)) },
      { label: 'Atm Head', names: names(atmDesk ? [atmDesk] : pid ? headsOf.get(pid) ?? [] : []) },
    ])
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
    enteredAt: r.created_at,
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

  return {
    bills, subs, mains, hubProjects, teams, subPositions, mainPositions,
    mySubs: new Set([...me.desks.map(d => d.subprojectId).filter((v): v is number => v != null), ...me.atmSubprojects]),
    myHubProjects: new Set([...me.desks.map(d => d.projectId).filter((v): v is string => !!v), ...me.atmProjects]),
    now: Date.now(),
  }
}
