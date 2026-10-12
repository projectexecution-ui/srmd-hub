// The Bills home, project-first (Aksha, 12 Oct 2026: "keep 2 Views … Projects
// Tree View with the Status in tree … the best view as well in toggle - with
// all data of the Project as there are main and sub project as this is very
// imp - and more easy way to check which Project the person is doing work").
//
// Both views are built from one shape here: IN4's own main project → sub-
// project (IN4 is two levels — 36 projects, 123 sub-projects), full names, not
// the short codes the desk list showed ("WCE" for Welcome Centre Extension).
// Pure: rows in, tree out, so it is tested.

import { PIPELINE, isTerminal, type BbStage } from './stages'

export interface ViewBill {
  id: string
  vendor: string
  billNo: string | null
  orderType: string
  orderNo: string | null
  amount: number
  stage: BbStage
  stageSince: string
  subprojectId: number | null
  /** CT Hub project, when the bill has one and IN4 does not. */
  hubProjectId: string | null
  holders: string[]
  /** The viewer is on the desk holding it now. */
  mine: boolean
  isExample: boolean
}

export interface SubRef { id: number; name: string; projectId: number | null }
export interface MainRef { id: number; name: string }

export interface TeamSeat { label: string; names: string[] }

export interface StageCell { n: number; amount: number }

export interface SubNode {
  key: string
  /** The sub-project as people say it — the main project's name taken off the front. */
  name: string
  fullName: string
  n: number
  amount: number
  byStage: Partial<Record<BbStage, StageCell>>
  oldestDays: number
  waitingOnMe: number
  team: TeamSeat[]
  bills: Array<ViewBill & { days: number }>
}

export interface MainNode {
  key: string
  name: string
  n: number
  amount: number
  byStage: Partial<Record<BbStage, StageCell>>
  oldestDays: number
  waitingOnMe: number
  /** The viewer works on this project — holds one of its bills, or sits on a
   *  desk named for it (not merely a desk that covers every project). */
  mine: boolean
  subs: SubNode[]
}

/** The steps shown as the tree's status columns, in the order a bill walks. */
export const TREE_STAGES: BbStage[] = PIPELINE.filter(s => s.key !== 'paid').map(s => s.key)

const DAY = 86_400_000

export function shortSubName(main: string, sub: string): string {
  const esc = main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const t = sub.replace(new RegExp(`^${esc}\\s*[-–:]?\\s*`, 'i'), '').trim()
  return t && t !== sub ? t : sub
}

function bump(cells: Partial<Record<BbStage, StageCell>>, stage: BbStage, amount: number) {
  const c = cells[stage] ?? { n: 0, amount: 0 }
  c.n += 1; c.amount += amount
  cells[stage] = c
}

export function buildProjectViews(input: {
  bills: ViewBill[]
  subs: Map<number, SubRef>
  mains: Map<number, MainRef>
  /** CT Hub project names, for a bill with no IN4 sub-project. */
  hubProjects: Map<string, { name: string; parentName: string | null }>
  /** Sub-projects / hub projects the viewer holds a named seat on. */
  mySubs: Set<number>
  myHubProjects: Set<string>
  /** Team per sub-project key (`s:<id>` or `h:<hubId>`). */
  teams: Map<string, TeamSeat[]>
  now: number
}): MainNode[] {
  const mains = new Map<string, MainNode>()
  const subsOf = new Map<string, Map<string, SubNode>>()

  for (const b of input.bills) {
    if (isTerminal(b.stage) || b.isExample) continue
    let mainKey: string, mainName: string, subKey: string, subFull: string
    const sub = b.subprojectId != null ? input.subs.get(b.subprojectId) : undefined
    if (sub) {
      const main = sub.projectId != null ? input.mains.get(sub.projectId) : undefined
      mainKey = `m:${sub.projectId ?? 'none'}`
      mainName = main?.name ?? 'IN4 project not known'
      subKey = `s:${sub.id}`
      subFull = sub.name
    } else if (b.hubProjectId && input.hubProjects.has(b.hubProjectId)) {
      const hp = input.hubProjects.get(b.hubProjectId)!
      mainKey = `h:${hp.parentName ?? hp.name}`
      mainName = hp.parentName ?? hp.name
      subKey = `h:${b.hubProjectId}`
      subFull = hp.name
    } else {
      mainKey = 'none'; mainName = 'No project set'; subKey = 'none'; subFull = 'No sub-project'
    }

    const days = Math.max(0, Math.floor((input.now - Date.parse(b.stageSince)) / DAY))
    let m = mains.get(mainKey)
    if (!m) {
      m = { key: mainKey, name: mainName, n: 0, amount: 0, byStage: {}, oldestDays: 0, waitingOnMe: 0, mine: false, subs: [] }
      mains.set(mainKey, m); subsOf.set(mainKey, new Map())
    }
    const subs = subsOf.get(mainKey)!
    let s = subs.get(subKey)
    if (!s) {
      s = { key: subKey, name: shortSubName(mainName, subFull), fullName: subFull, n: 0, amount: 0, byStage: {},
            oldestDays: 0, waitingOnMe: 0, team: input.teams.get(subKey) ?? [], bills: [] }
      subs.set(subKey, s)
    }
    for (const node of [m, s]) {
      node.n += 1; node.amount += b.amount
      bump(node.byStage, b.stage, b.amount)
      node.oldestDays = Math.max(node.oldestDays, days)
      if (b.mine) node.waitingOnMe += 1
    }
    s.bills.push({ ...b, days })
    const named = (b.subprojectId != null && input.mySubs.has(b.subprojectId))
      || (!!b.hubProjectId && input.myHubProjects.has(b.hubProjectId))
    if (b.mine || named) m.mine = true
  }

  const order = (st: BbStage) => { const i = TREE_STAGES.indexOf(st); return i < 0 ? 99 : i }
  for (const [k, m] of mains) {
    m.subs = [...subsOf.get(k)!.values()].sort((a, b) => b.waitingOnMe - a.waitingOnMe || b.n - a.n || a.name.localeCompare(b.name))
    // In a box: the order a bill walks, then longest at its desk first.
    for (const s of m.subs) s.bills.sort((a, b) => order(a.stage) - order(b.stage) || b.days - a.days)
  }
  // The viewer's projects first, then what is waiting on them, then the busiest.
  return [...mains.values()].sort((a, b) =>
    Number(b.mine) - Number(a.mine) || b.waitingOnMe - a.waitingOnMe || b.n - a.n || a.name.localeCompare(b.name))
}

/** "Disc Head 2 · CT Head 1" — the tree's status columns as one line, for a phone. */
export function stageLine(byStage: Partial<Record<BbStage, StageCell>>, label: (s: BbStage) => string): string {
  return TREE_STAGES.filter(s => byStage[s]?.n).map(s => `${label(s)} ${byStage[s]!.n}`).join(' · ')
}
