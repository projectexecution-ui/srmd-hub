// Budget vs Actual V2 — pure consolidation engine.
//
// READ-ONLY over the three existing state blobs (budget_hub_state,
// contractor_report_state, supplier_report_state). Produces one grouped tree:
//
//   Group (alpha) → Project (open top / closed dimmed) → Category → Sub-Category
//                                                          └→ Party (contractor|supplier)
//
// Budget + Spent come from the BPH (budget) source at Category/Sub-Category.
// Party rows + Outstanding come from the payment sources, attached to a budget
// project via the confirmed alias map (AI-suggested, human-confirmed) with an
// exact-name fallback. Anything that can't be matched is SURFACED in `unmatched`
// — never dropped. ₹/sft is computed by the caller (needs project area).

// ─── Loose input shapes (as stored in jsonb) ───────────────────────────────
interface BudgetRow { head?: string; budget?: number; actual?: number; catNum?: string; subNum?: string }
interface BudgetProjectRaw {
  name?: string; type?: string; parentId?: string | null
  areaStatement?: { builtUp?: number | null } | null
  data?: { rows?: BudgetRow[]; subRows?: BudgetRow[] } | null
}
interface PartyRaw {
  contractor?: string; supplier?: string
  woValue?: number; billValue?: number; paidValue?: number; outstanding?: number
}
interface PayCategoryRaw { category?: string; contractors?: PartyRaw[]; suppliers?: PartyRaw[] }
interface PaySubprojectRaw { name?: string; categories?: PayCategoryRaw[] }
interface PayReportRaw { projectName?: string; subprojects?: PaySubprojectRaw[] }

export interface AliasRow { source: 'contractor' | 'supplier'; payment_name: string; budget_project: string | null; confirmed: boolean }
export type StatusMap = Record<string, 'open' | 'closed'>

// ─── Output tree ────────────────────────────────────────────────────────────
export interface PartyLine {
  name: string
  source: 'contractor' | 'supplier'
  wo: number
  paid: number
  outstanding: number
  via: string // which payment sub-project it came from (for transparency)
}
export interface SubCatNode { code: string; label: string; budget: number; spent: number }
export interface CatNode {
  code: string
  label: string
  budget: number
  spent: number
  outstanding: number
  hasBudget: boolean // false when the node exists only because of payments (no BPH line)
  subcats: SubCatNode[]
  parties: PartyLine[]
}
export interface ProjectNode {
  name: string
  status: 'open' | 'closed'
  area: number | null
  budget: number
  spent: number
  outstanding: number
  categories: CatNode[]
}
export interface GroupNode {
  name: string
  budget: number
  spent: number
  outstanding: number
  area: number
  projects: ProjectNode[]
}
export interface UnmatchedPayment {
  source: 'contractor' | 'supplier'
  paymentName: string
  paid: number
  outstanding: number
}
export interface ComposeResult {
  groups: GroupNode[]
  totals: { budget: number; spent: number; outstanding: number; area: number }
  unmatched: UnmatchedPayment[]
}

// ─── helpers ────────────────────────────────────────────────────────────────
const n = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)

/** Leading numeric code → integer key (so "001", "01", " 03 " all normalise). NaN-safe. */
function codeKey(raw: string | undefined): string {
  const m = (raw ?? '').trim().match(/^(\d+)/)
  return m ? String(parseInt(m[1], 10)) : (raw ?? '').trim().toLowerCase()
}
function splitCode(raw: string | undefined): { code: string; label: string } {
  const s = (raw ?? '').trim()
  const m = s.match(/^(\d+)\s*(.*)$/)
  if (m) return { code: m[1].replace(/^0+(?=\d)/, ''), label: m[2].trim() || s }
  return { code: '', label: s }
}
/** Normalise a project/sub-project name for the exact-match fallback. */
export function normName(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s*[-–]\s*(execution|design|professional consultancy|interior scope|common expenses|infra work|bhoomi pujan).*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// ─── compose ─────────────────────────────────────────────────────────────────
export function composeBudgetV2(
  budgetProjects: BudgetProjectRaw[],
  contractorReports: PayReportRaw[],
  supplierReports: PayReportRaw[],
  aliases: AliasRow[],
  status: StatusMap,
): ComposeResult {
  // 1) Index budget groups + build project nodes from budget data.
  const groupNameById = new Map<string, string>()
  for (const p of budgetProjects) {
    if (p.type === 'group' && p.name) groupNameById.set(idOf(p), p.name)
  }

  const projectByName = new Map<string, ProjectNode>()   // budget project name → node
  const projectGroup = new Map<string, string>()         // project name → group name ('' = ungrouped)

  for (const p of budgetProjects) {
    if (p.type === 'group' || !p.name) continue
    const node = buildProjectFromBudget(p, status)
    projectByName.set(p.name, node)
    const gname = p.parentId ? (groupNameById.get(p.parentId) ?? '') : ''
    projectGroup.set(p.name, gname)
  }

  // 2) Build the exact-match fallback index (normalised budget name → real name).
  const byNorm = new Map<string, string>()
  for (const name of projectByName.keys()) byNorm.set(normName(name), name)

  // 3) Confirmed alias lookup.
  const aliasMap = new Map<string, string | null>() // `${source}::${payment_name}` → budget project | null
  for (const a of aliases) if (a.confirmed) aliasMap.set(`${a.source}::${a.payment_name}`, a.budget_project)

  const unmatched: UnmatchedPayment[] = []
  const resolve = (source: 'contractor' | 'supplier', payName: string): ProjectNode | null => {
    const aliased = aliasMap.get(`${source}::${payName}`)
    if (aliased !== undefined) return aliased ? (projectByName.get(aliased) ?? null) : null // null = intentionally ignored
    const exact = byNorm.get(normName(payName))
    return exact ? projectByName.get(exact)! : null
  }

  // 4) Fold payment sources into the budget projects.
  const fold = (reports: PayReportRaw[], source: 'contractor' | 'supplier') => {
    for (const r of reports) {
      for (const sp of r.subprojects ?? []) {
        const payName = sp.name ?? ''
        const proj = resolve(source, payName)
        // sum this sub-project's totals once (for the unmatched bucket)
        let spPaid = 0, spOut = 0
        for (const cat of sp.categories ?? []) {
          for (const party of partiesOf(cat, source)) { spPaid += n(party.paidValue); spOut += n(party.outstanding) }
        }
        if (!proj) {
          if (aliasMap.get(`${source}::${payName}`) === null) continue // explicitly ignored
          if (spPaid !== 0 || spOut !== 0) unmatched.push({ source, paymentName: payName, paid: spPaid, outstanding: spOut })
          continue
        }
        for (const cat of sp.categories ?? []) {
          const { code, label } = splitCode(cat.category)
          const catNode = findOrCreateCat(proj, code, label)
          for (const party of partiesOf(cat, source)) {
            const pname = (source === 'contractor' ? party.contractor : party.supplier) ?? '—'
            catNode.parties.push({
              name: pname, source,
              wo: n(party.woValue), paid: n(party.paidValue), outstanding: n(party.outstanding),
              via: payName,
            })
            catNode.outstanding += n(party.outstanding)
            proj.outstanding += n(party.outstanding)
          }
        }
      }
    }
  }
  fold(contractorReports, 'contractor')
  fold(supplierReports, 'supplier')

  // 5) Group + sort.
  const groupMap = new Map<string, ProjectNode[]>()
  for (const [name, node] of projectByName) {
    const g = projectGroup.get(name) || '— Ungrouped'
    if (!groupMap.has(g)) groupMap.set(g, [])
    groupMap.get(g)!.push(node)
  }
  const groups: GroupNode[] = Array.from(groupMap.entries())
    .map(([gname, projs]) => {
      projs.sort(projectSort)
      return {
        name: gname,
        projects: projs,
        budget: sum(projs, p => p.budget),
        spent: sum(projs, p => p.spent),
        outstanding: sum(projs, p => p.outstanding),
        area: sum(projs, p => p.area ?? 0),
      }
    })
    .sort((a, b) => {
      if (a.name === '— Ungrouped') return 1
      if (b.name === '— Ungrouped') return -1
      return a.name.localeCompare(b.name)
    })

  return {
    groups,
    totals: {
      budget: sum(groups, g => g.budget),
      spent: sum(groups, g => g.spent),
      outstanding: sum(groups, g => g.outstanding),
      area: sum(groups, g => g.area),
    },
    unmatched: unmatched.sort((a, b) => b.paid - a.paid),
  }
}

function idOf(p: BudgetProjectRaw): string {
  // budget-hub stores an `id` we don't type; fall back to name. parentId references it.
  return ((p as unknown as { id?: string }).id) ?? (p.name ?? '')
}

function buildProjectFromBudget(p: BudgetProjectRaw, status: StatusMap): ProjectNode {
  const cats = new Map<string, CatNode>()
  for (const row of p.data?.rows ?? []) {
    const key = codeKey(row.catNum ?? row.head)
    const { code, label } = splitCode(row.head)
    const c = cats.get(key) ?? { code: code || key, label, budget: 0, spent: 0, outstanding: 0, hasBudget: true, subcats: [], parties: [] }
    c.budget += n(row.budget); c.spent += n(row.actual); c.hasBudget = true
    cats.set(key, c)
  }
  for (const sr of p.data?.subRows ?? []) {
    const key = codeKey(sr.catNum)
    let c = cats.get(key)
    if (!c) { c = { code: String(sr.catNum ?? ''), label: 'Other', budget: 0, spent: 0, outstanding: 0, hasBudget: true, subcats: [], parties: [] }; cats.set(key, c) }
    const { code, label } = splitCode(sr.head)
    c.subcats.push({ code: code || (sr.subNum ?? ''), label, budget: n(sr.budget), spent: n(sr.actual) })
  }
  const categories = Array.from(cats.values()).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  return {
    name: p.name!,
    status: status[p.name!] ?? 'open',
    area: typeof p.areaStatement?.builtUp === 'number' && p.areaStatement.builtUp > 0 ? p.areaStatement.builtUp : null,
    budget: sum(categories, c => c.budget),
    spent: sum(categories, c => c.spent),
    outstanding: 0,
    categories,
  }
}

function findOrCreateCat(proj: ProjectNode, code: string, label: string): CatNode {
  const key = codeKey(code || label)
  for (const c of proj.categories) if (codeKey(c.code) === key || normName(c.label) === normName(label)) return c
  const fresh: CatNode = { code: code || key, label: label || 'Uncategorised', budget: 0, spent: 0, outstanding: 0, hasBudget: false, subcats: [], parties: [] }
  proj.categories.push(fresh)
  return fresh
}

function partiesOf(cat: PayCategoryRaw, source: 'contractor' | 'supplier'): PartyRaw[] {
  return (source === 'contractor' ? cat.contractors : cat.suppliers) ?? []
}
function sum<T>(arr: T[], f: (t: T) => number): number { return arr.reduce((s, t) => s + f(t), 0) }
function projectSort(a: ProjectNode, b: ProjectNode): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1 // open first
  return a.name.localeCompare(b.name)
}
