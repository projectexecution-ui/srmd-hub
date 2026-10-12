// The Bills home, project-first (Aksha, 12 Oct 2026: "keep 2 Views … Projects
// Tree View with the Status in tree … the best view as well in toggle - with
// all data of the Project as there are main and sub project as this is very
// imp - and more easy way to check which Project the person is doing work";
// then "Still i am unhappy with the view - can u enhance").
//
// One shape feeds both views: IN4's own main project → sub-project (IN4 is two
// levels — 36 projects, 123 sub-projects), full names, each with its IN4
// position (orders · billed · paid · balance) beside the bills pending here.
// Filters (scope, step, person, search) and the step strip are worked out
// here too. Pure: rows in, tree out, so it is tested.

import { PIPELINE, isTerminal, ageTone, type AgeTone, type BbStage } from './stages'

export interface ViewBill {
  id: string
  vendor: string
  billNo: string | null
  orderType: string
  orderNo: string | null
  amount: number
  stage: BbStage
  stageSince: string
  /** When the bill was entered in CT Hub — the clock for "pending since entry". */
  enteredAt: string
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
export interface StageCell { n: number; amount: number; late: number }

/** IN4's money on a project or sub-project — the whole of it, not only what
 *  is pending here. Balance = billed − paid. */
export interface Position { orders: number; woCount: number; billed: number; paid: number }

/** `days` = at the desk holding it now; `pendingDays` = since it was entered
 *  (Aksha, 12 Oct 2026: "from the date of Entry - how many days its pending"). */
export type ShownBill = ViewBill & { days: number; tone: AgeTone; pendingDays: number }

export interface SubNode {
  key: string
  /** The sub-project as people say it — the main project's name taken off the front. */
  name: string
  fullName: string
  n: number
  amount: number
  late: number
  byStage: Partial<Record<BbStage, StageCell>>
  oldestDays: number
  /** The oldest bill here, in days since it was entered. */
  oldestPending: number
  waitingOnMe: number
  team: TeamSeat[]
  position: Position | null
  bills: ShownBill[]
}

export interface MainNode {
  key: string
  name: string
  n: number
  amount: number
  late: number
  byStage: Partial<Record<BbStage, StageCell>>
  oldestDays: number
  oldestPending: number
  waitingOnMe: number
  /** The viewer works on this project — holds one of its bills, or sits on a
   *  desk named for it (not merely a desk that covers every project). */
  mine: boolean
  position: Position | null
  subs: SubNode[]
}

/** The steps shown as the tree's status columns, in the order a bill walks. */
export const TREE_STAGES: BbStage[] = PIPELINE.filter(s => s.key !== 'paid').map(s => s.key)

export type Scope = 'mine' | 'projects' | 'all'
export type SortBy = 'wait' | 'amount' | 'name'
export interface ViewFilters { scope: Scope; stage: BbStage | null; who: string | null; q: string | null; sort: SortBy }

const DAY = 86_400_000
const daysSince = (iso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(iso)) / DAY)) || 0

export function shortSubName(main: string, sub: string): string {
  const esc = main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const t = sub.replace(new RegExp(`^${esc}\\s*[-–:]?\\s*`, 'i'), '').trim()
  return t && t !== sub ? t : sub
}

function bump(cells: Partial<Record<BbStage, StageCell>>, stage: BbStage, amount: number, late: boolean) {
  const c = cells[stage] ?? { n: 0, amount: 0, late: 0 }
  c.n += 1; c.amount += amount; if (late) c.late += 1
  cells[stage] = c
}

export interface BuildInput {
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
  /** IN4 position per sub-project id, and per main-project id. */
  subPositions?: Map<number, Position>
  mainPositions?: Map<number, Position>
  now: number
}

/** Which main project a bill sits under, and the words to search it by. */
export function placeOf(b: ViewBill, input: Pick<BuildInput, 'subs' | 'mains' | 'hubProjects'>): { key: string; text: string } {
  const sub = b.subprojectId != null ? input.subs.get(b.subprojectId) : undefined
  if (sub) {
    const main = sub.projectId != null ? input.mains.get(sub.projectId) : undefined
    return { key: `m:${sub.projectId ?? 'none'}`, text: `${main?.name ?? ''} ${sub.name}` }
  }
  const hp = b.hubProjectId ? input.hubProjects.get(b.hubProjectId) : undefined
  if (hp) return { key: `h:${hp.parentName ?? hp.name}`, text: `${hp.parentName ?? ''} ${hp.name}` }
  return { key: 'none', text: '' }
}

export function buildProjectViews(input: BuildInput): MainNode[] {
  const mains = new Map<string, MainNode>()
  const subsOf = new Map<string, Map<string, SubNode>>()

  for (const b of input.bills) {
    if (isTerminal(b.stage) || b.isExample) continue
    let mainKey: string, mainName: string, subKey: string, subFull: string
    let mainPos: Position | null = null, subPos: Position | null = null
    const sub = b.subprojectId != null ? input.subs.get(b.subprojectId) : undefined
    if (sub) {
      const main = sub.projectId != null ? input.mains.get(sub.projectId) : undefined
      mainKey = `m:${sub.projectId ?? 'none'}`
      mainName = main?.name ?? 'IN4 project not known'
      subKey = `s:${sub.id}`
      subFull = sub.name
      subPos = input.subPositions?.get(sub.id) ?? null
      mainPos = sub.projectId != null ? input.mainPositions?.get(sub.projectId) ?? null : null
    } else if (b.hubProjectId && input.hubProjects.has(b.hubProjectId)) {
      const hp = input.hubProjects.get(b.hubProjectId)!
      mainKey = `h:${hp.parentName ?? hp.name}`
      mainName = hp.parentName ?? hp.name
      subKey = `h:${b.hubProjectId}`
      subFull = hp.name
    } else {
      mainKey = 'none'; mainName = 'No project set'; subKey = 'none'; subFull = 'No sub-project'
    }

    const days = daysSince(b.stageSince, input.now)
    const pendingDays = daysSince(b.enteredAt, input.now)
    const tone = ageTone(b.stage, b.stageSince, input.now)
    const late = tone === 'warn' || tone === 'late'
    let m = mains.get(mainKey)
    if (!m) {
      m = { key: mainKey, name: mainName, n: 0, amount: 0, late: 0, byStage: {}, oldestDays: 0, oldestPending: 0, waitingOnMe: 0, mine: false, position: mainPos, subs: [] }
      mains.set(mainKey, m); subsOf.set(mainKey, new Map())
    }
    const subs = subsOf.get(mainKey)!
    let s = subs.get(subKey)
    if (!s) {
      s = { key: subKey, name: shortSubName(mainName, subFull), fullName: subFull, n: 0, amount: 0, late: 0, byStage: {},
            oldestDays: 0, oldestPending: 0, waitingOnMe: 0, team: input.teams.get(subKey) ?? [], position: subPos, bills: [] }
      subs.set(subKey, s)
    }
    for (const node of [m, s]) {
      node.n += 1; node.amount += b.amount
      if (late) node.late += 1
      bump(node.byStage, b.stage, b.amount, late)
      node.oldestDays = Math.max(node.oldestDays, days)
      node.oldestPending = Math.max(node.oldestPending, pendingDays)
      if (b.mine) node.waitingOnMe += 1
    }
    s.bills.push({ ...b, days, tone, pendingDays })
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
  return [...mains.values()]
}

/** Which bills a filter keeps, before the tree is built. Scope "projects" is
 *  applied after, on the built projects (it needs to know which are mine). */
export function filterBills(
  bills: ViewBill[], f: Pick<ViewFilters, 'scope' | 'stage' | 'who' | 'q'>, withStage = true,
  /** The bill's project and sub-project names, so a search finds them too. */
  placeOf?: (b: ViewBill) => string,
): ViewBill[] {
  const q = f.q?.trim().toLowerCase() || null
  return bills.filter(b =>
    (f.scope !== 'mine' || b.mine)
    && (!withStage || !f.stage || b.stage === f.stage)
    && (!f.who || b.holders.includes(f.who))
    && (!q || [b.vendor, b.billNo, b.orderNo, placeOf?.(b)].some(v => (v ?? '').toLowerCase().includes(q))))
}

/** Search also matches project and sub-project names — a project that matches
 *  keeps all its bills. */
export function matchesProject(m: MainNode, q: string | null): boolean {
  const t = q?.trim().toLowerCase()
  if (!t) return false
  return m.name.toLowerCase().includes(t) || m.subs.some(s => s.fullName.toLowerCase().includes(t))
}

export function sortMains(mains: MainNode[], sort: SortBy): MainNode[] {
  const by = (a: MainNode, b: MainNode) =>
    sort === 'amount' ? b.amount - a.amount
      : sort === 'name' ? a.name.localeCompare(b.name)
        : b.oldestPending - a.oldestPending || b.oldestDays - a.oldestDays || b.late - a.late
  // The viewer's projects first, then what waits on them, then the chosen order.
  return [...mains].sort((a, b) => Number(b.mine) - Number(a.mine) || b.waitingOnMe - a.waitingOnMe || by(a, b))
}

/** The step strip: count, money and late per step over the bills in view. */
export function stageTotals(bills: ViewBill[], now: number): Record<string, StageCell> {
  const out: Record<string, StageCell> = {}
  for (const b of bills) {
    if (isTerminal(b.stage) || b.isExample) continue
    const t = ageTone(b.stage, b.stageSince, now)
    bump(out as Partial<Record<BbStage, StageCell>>, b.stage, b.amount, t === 'warn' || t === 'late')
  }
  return out
}

/** "Disc Head 2 · CT Head 1" — the tree's status columns as one line, for a phone. */
export function stageLine(byStage: Partial<Record<BbStage, StageCell>>, label: (s: BbStage) => string): string {
  return TREE_STAGES.filter(s => byStage[s]?.n).map(s => `${label(s)} ${byStage[s]!.n}`).join(' · ')
}

export function sumPositions(ps: Position[]): Position {
  return ps.reduce((a, p) => ({ orders: a.orders + p.orders, woCount: a.woCount + p.woCount, billed: a.billed + p.billed, paid: a.paid + p.paid }),
    { orders: 0, woCount: 0, billed: 0, paid: 0 })
}
