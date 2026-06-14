// Budget vs Actual V2 — pure consolidation engine.
//
// READ-ONLY over the three existing state blobs. Produces one grouped tree:
//   Group → Project (open/closed) → Category → Sub-Category
//                                    └→ Party (contractor|supplier)
//
// Budget + Spent + sub-categories come from the BPH (budget) source. Parties +
// Outstanding come from payments, attached to a budget project.
//
// SIMPLIFIED MATCHING (map once per project): the admin maps a payment PROJECT
// name → a budget GROUP (or project) once. Each payment sub-project then resolves
// to the specific budget project automatically by its block token (A/B/C/Common/
// Infra…). Order: line-alias → project-alias(+block resolve) → exact name. What
// still can't be placed is SURFACED (unmatchedProjects / unmatchedLines), never
// dropped. ₹/sft is computed by the caller (needs project area).

interface BudgetRow { head?: string; budget?: number; actual?: number; catNum?: string; subNum?: string }
interface BudgetProjectRaw {
  name?: string; type?: string; parentId?: string | null
  areaStatement?: { builtUp?: number | null } | null
  data?: { rows?: BudgetRow[]; subRows?: BudgetRow[] } | null
}
interface PartyRaw { contractor?: string; supplier?: string; woValue?: number; billValue?: number; paidValue?: number; outstanding?: number }
interface PayCategoryRaw { category?: string; contractors?: PartyRaw[]; suppliers?: PartyRaw[] }
interface PaySubprojectRaw { name?: string; categories?: PayCategoryRaw[] }
interface PayReportRaw { projectName?: string; subprojects?: PaySubprojectRaw[] }

export type Src = 'contractor' | 'supplier'
export interface AliasRow { source: Src; payment_name: string; budget_project: string | null; confirmed: boolean }
export type StatusMap = Record<string, 'open' | 'closed'>
/** Per-project area override (overrides budget_hub_state.areaStatement.builtUp). */
export type AreaOverrideMap = Record<string, number>
/** Extra projects that don't exist in BPH yet — V2 placeholders. */
export interface ExtraProject { name: string; group_name?: string | null; area_sft?: number | null }

export interface PartyLine { name: string; source: Src; wo: number; paid: number; outstanding: number; via: string }
export interface SubCatNode { code: string; label: string; budget: number; spent: number }
export interface CatNode { code: string; label: string; budget: number; spent: number; outstanding: number; hasBudget: boolean; subcats: SubCatNode[]; parties: PartyLine[] }
export interface ProjectNode { name: string; group: string; status: 'open' | 'closed'; area: number | null; budget: number; spent: number; outstanding: number; categories: CatNode[] }
export interface GroupNode { name: string; budget: number; spent: number; outstanding: number; area: number; projects: ProjectNode[] }
export interface UnmatchedProject { source: Src; projectName: string; paid: number; outstanding: number; subCount: number }
export interface UnmatchedLine { source: Src; subprojectName: string; viaProject: string; group: string; paid: number; outstanding: number }
export interface ComposeResult {
  groups: GroupNode[]
  totals: { budget: number; spent: number; outstanding: number; area: number }
  unmatchedProjects: UnmatchedProject[]
  unmatchedLines: UnmatchedLine[]
}

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
const tokens = (s: string): string[] => ((s ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [])
function tokenIn(token: string, rawLower: string): boolean {
  const t = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`).test(rawLower)
}
// IN4 sometimes splits a category into "(A)/(M)/(L)/(C)" variants on separate
// lines — e.g. "001 (A) Site Pre-lims" + "01 Site Pre-lims" are two BPH rows
// that mean the SAME category, just split by asset vs material/labour. For
// V2 we MERGE them under one human-named category so the tree doesn't read
// like a duplicate. SRAH's "01 Pre Design Works" stays separate from
// "001 (A) Site Pre-lims" because the labels differ — merging is by LABEL,
// not code.
function catMarker(s: string | undefined): string {
  const m = (s ?? '').match(/\(([AMLC])\)/i)
  return m ? m[1].toUpperCase() : ''
}
function splitCode(raw: string | undefined): { code: string; label: string } {
  const s = (raw ?? '').trim()
  const m = s.match(/^(\d+)\s*(.*)$/)
  if (m) return { code: m[1], label: m[2].trim() || s }
  return { code: '', label: s }
}
/** Strip the "(A)/(M)/…" marker AND the leading number, then normalise. The
 *  result is what we group by — "001 (A) Site Pre-lims" → "site pre lims". */
function labelKey(rawHead: string | undefined): string {
  const { label } = splitCode(rawHead)
  return label.replace(/\([AMLC]\)/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
export function normName(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\s*[-–]\s*(execution|design|professional consultancy|interior scope|common expenses|infra work|bhoomi pujan).*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function composeBudgetV2(
  budgetProjects: BudgetProjectRaw[],
  contractorReports: PayReportRaw[],
  supplierReports: PayReportRaw[],
  aliases: AliasRow[],
  status: StatusMap,
  /** Per-project area override (V2-owned). When set, beats budget_hub_state.areaStatement.builtUp. */
  areaOverrides: AreaOverrideMap = {},
  /** Extra V2-owned projects/groups that don't exist in BPH yet. */
  extras: ExtraProject[] = [],
): ComposeResult {
  const groupNameById = new Map<string, string>()
  for (const p of budgetProjects) if (p.type === 'group' && p.name) groupNameById.set(idOf(p), p.name)

  const projectByName = new Map<string, ProjectNode>()
  const projectsByGroup = new Map<string, ProjectNode[]>()
  for (const p of budgetProjects) {
    if (p.type === 'group' || !p.name) continue
    const gname = p.parentId ? (groupNameById.get(p.parentId) ?? '') : ''
    const node = buildProjectFromBudget(p, gname || '— Ungrouped', status)
    // Apply V2 area override (admin-set in V2; doesn't touch the original).
    const ov = areaOverrides[p.name!]
    if (typeof ov === 'number' && ov > 0) node.area = ov
    projectByName.set(p.name, node)
    const gk = node.group
    if (!projectsByGroup.has(gk)) projectsByGroup.set(gk, [])
    projectsByGroup.get(gk)!.push(node)
  }
  // V2-owned EXTRA projects: appear in the tree as empty-budget placeholders;
  // status + area + group all come from this table. Their group becomes a
  // valid group_name even if BPH has no such group yet (so payments mapped to
  // it can resolve).
  const groupNames = new Set(Array.from(groupNameById.values()))
  for (const ex of extras) {
    if (!ex.name) continue
    if (projectByName.has(ex.name)) continue // BPH wins if a project already exists
    const gname = (ex.group_name ?? '').trim() || '— Ungrouped'
    const area = typeof ex.area_sft === 'number' && ex.area_sft > 0 ? ex.area_sft : null
    const node: ProjectNode = {
      name: ex.name, group: gname,
      status: status[ex.name] ?? 'open',
      area: areaOverrides[ex.name] ?? area,
      budget: 0, spent: 0, outstanding: 0, categories: [],
    }
    projectByName.set(ex.name, node)
    if (!projectsByGroup.has(gname)) projectsByGroup.set(gname, [])
    projectsByGroup.get(gname)!.push(node)
    if (gname !== '— Ungrouped') groupNames.add(gname)
  }
  const byNorm = new Map<string, string>()
  for (const name of projectByName.keys()) byNorm.set(normName(name), name)

  const aliasMap = new Map<string, string | null>()
  for (const a of aliases) if (a.confirmed) aliasMap.set(`${a.source}::${a.payment_name}`, a.budget_project)

  type Res = { kind: 'project'; node: ProjectNode } | { kind: 'ignore' } | { kind: 'ambiguous'; group: string } | { kind: 'none' }
  const targetToProject = (target: string, subName: string): Res => {
    const proj = projectByName.get(target)
    if (proj) return { kind: 'project', node: proj }
    if (groupNames.has(target)) {
      const inGroup = projectsByGroup.get(target) ?? []
      const node = resolveInGroup(target, inGroup, subName)
      return node ? { kind: 'project', node } : { kind: 'ambiguous', group: target }
    }
    return { kind: 'none' }
  }
  const resolve = (source: Src, projectName: string, subName: string): Res => {
    const la = aliasMap.get(`${source}::${subName}`)
    if (la !== undefined) return la === null ? { kind: 'ignore' } : targetToProject(la, subName)
    const pa = aliasMap.get(`${source}::${projectName}`)
    if (pa !== undefined) return pa === null ? { kind: 'ignore' } : targetToProject(pa, subName)
    const ex = byNorm.get(normName(subName)); if (ex) return { kind: 'project', node: projectByName.get(ex)! }
    const exp = byNorm.get(normName(projectName)); if (exp) return { kind: 'project', node: projectByName.get(exp)! }
    return { kind: 'none' }
  }

  const unmatchedProjects = new Map<string, UnmatchedProject>()
  const unmatchedLines: UnmatchedLine[] = []

  const fold = (reports: PayReportRaw[], source: Src) => {
    for (const r of reports) {
      const projectName = r.projectName ?? '(unknown)'
      for (const sp of r.subprojects ?? []) {
        let spPaid = 0, spOut = 0
        for (const cat of sp.categories ?? []) for (const party of partiesOf(cat, source)) { spPaid += num(party.paidValue); spOut += num(party.outstanding) }
        const res = resolve(source, projectName, sp.name ?? '')
        if (res.kind === 'ignore') continue
        if (res.kind === 'none') {
          const k = `${source}::${projectName}`
          const u = unmatchedProjects.get(k) ?? { source, projectName, paid: 0, outstanding: 0, subCount: 0 }
          u.paid += spPaid; u.outstanding += spOut; u.subCount += 1
          unmatchedProjects.set(k, u)
          continue
        }
        if (res.kind === 'ambiguous') {
          if (spPaid !== 0 || spOut !== 0) unmatchedLines.push({ source, subprojectName: sp.name ?? '', viaProject: projectName, group: res.group, paid: spPaid, outstanding: spOut })
          continue
        }
        const proj = res.node
        for (const cat of sp.categories ?? []) {
          const { code, label } = splitCode(cat.category)
          const catNode = findOrCreateCat(proj, code, label)
          for (const party of partiesOf(cat, source)) {
            catNode.parties.push({
              name: (source === 'contractor' ? party.contractor : party.supplier) ?? '—',
              source, wo: num(party.woValue), paid: num(party.paidValue), outstanding: num(party.outstanding), via: sp.name ?? '',
            })
            catNode.outstanding += num(party.outstanding)
            proj.outstanding += num(party.outstanding)
          }
        }
      }
    }
  }
  fold(contractorReports, 'contractor')
  fold(supplierReports, 'supplier')

  const groups: GroupNode[] = Array.from(projectsByGroup.entries())
    .map(([gname, projs]) => {
      projs.sort(projectSort)
      return { name: gname, projects: projs, budget: sum(projs, p => p.budget), spent: sum(projs, p => p.spent), outstanding: sum(projs, p => p.outstanding), area: sum(projs, p => p.area ?? 0) }
    })
    .sort((a, b) => (a.name === '— Ungrouped' ? 1 : b.name === '— Ungrouped' ? -1 : a.name.localeCompare(b.name)))

  return {
    groups,
    totals: { budget: sum(groups, g => g.budget), spent: sum(groups, g => g.spent), outstanding: sum(groups, g => g.outstanding), area: sum(groups, g => g.area) },
    unmatchedProjects: Array.from(unmatchedProjects.values()).sort((a, b) => b.paid - a.paid),
    unmatchedLines: unmatchedLines.sort((a, b) => b.paid - a.paid),
  }
}

// Pick the budget project within a group whose distinctive leaf token (A/B/C,
// Common, Infra, building name…) appears in the payment sub-project name.
// One clear winner → that project; tie or none → null (ambiguous).
function resolveInGroup(groupName: string, projects: ProjectNode[], subName: string): ProjectNode | null {
  if (projects.length === 0) return null
  if (projects.length === 1) return projects[0]
  const raw = (subName ?? '').toLowerCase()
  const gTok = new Set(tokens(groupName))
  let best: ProjectNode | null = null, bestScore = 0, tie = false
  for (const p of projects) {
    const leaf = tokens(p.name).filter(t => !gTok.has(t))
    const score = leaf.reduce((s, t) => s + (tokenIn(t, raw) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; best = p; tie = false }
    else if (score === bestScore && score > 0) tie = true
  }
  return bestScore > 0 && !tie ? best : null
}

function idOf(p: BudgetProjectRaw): string { return ((p as unknown as { id?: string }).id) ?? (p.name ?? '') }

function buildProjectFromBudget(p: BudgetProjectRaw, group: string, status: StatusMap): ProjectNode {
  // Group categories by LABEL (after stripping the (A)/(M) marker) so IN4's
  // split lines fold into ONE clean row. SRAH-style cases — different labels
  // that happen to share a code — stay separate because their labelKey differs.
  const cats = new Map<string, CatNode>()
  for (const row of p.data?.rows ?? []) {
    const key = labelKey(row.head)
    const { code, label } = splitCode(row.head)
    // Pick the cleanest representative label (no marker; shortest code wins).
    const cleanLabel = label.replace(/\([AMLC]\)\s*/i, '').trim() || label
    const c = cats.get(key) ?? { code: code || key, label: cleanLabel, budget: 0, spent: 0, outstanding: 0, hasBudget: true, subcats: [], parties: [] }
    // Prefer the unmarked label + lowest numeric code as the display.
    if (!catMarker(c.label) && !catMarker(row.head)) {
      if (cleanLabel.length < c.label.length || (cleanLabel === c.label && code && (!c.code || code.length < c.code.length))) c.label = cleanLabel
    } else if (catMarker(c.label) && !catMarker(row.head)) {
      c.label = cleanLabel
    }
    if (code && (!c.code || (code.replace(/^0+/, '').length < c.code.replace(/^0+/, '').length))) c.code = code
    c.budget += num(row.budget); c.spent += num(row.actual); c.hasBudget = true
    cats.set(key, c)
  }
  for (const sr of p.data?.subRows ?? []) {
    // Sub-rows attach by label-key so they land on the merged parent.
    const key = labelKeyForSubRow(sr.head, p.data?.rows ?? [], sr.catNum)
    let c = cats.get(key)
    if (!c) { c = { code: String(sr.catNum ?? ''), label: splitCode(sr.head).label || 'Other', budget: 0, spent: 0, outstanding: 0, hasBudget: true, subcats: [], parties: [] }; cats.set(key, c) }
    const { code, label } = splitCode(sr.head)
    c.subcats.push({ code: code || (sr.subNum ?? ''), label, budget: num(sr.budget), spent: num(sr.actual) })
  }
  const categories = Array.from(cats.values()).sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
  return {
    name: p.name!, group,
    status: status[p.name!] ?? 'open',
    area: typeof p.areaStatement?.builtUp === 'number' && p.areaStatement.builtUp > 0 ? p.areaStatement.builtUp : null,
    budget: sum(categories, c => c.budget), spent: sum(categories, c => c.spent), outstanding: 0, categories,
  }
}

function findOrCreateCat(proj: ProjectNode, code: string, label: string): CatNode {
  // Payments group by the SAME label-key as budget — so "(A) Site Pre-lims",
  // "(M) Site Pre-lims" and "Site Pre-lims" all land on the same node.
  const want = labelKey(`${code} ${label}`)
  for (const c of proj.categories) if (labelKey(`${c.code} ${c.label}`) === want) return c
  // Fallback: name match (handles cases where code is blank on one side).
  for (const c of proj.categories) if (normName(c.label) === normName(label)) return c
  const fresh: CatNode = {
    code: code || want,
    label: (label || 'Uncategorised').replace(/\([AMLC]\)\s*/i, '').trim() || 'Uncategorised',
    budget: 0, spent: 0, outstanding: 0, hasBudget: false, subcats: [], parties: [],
  }
  proj.categories.push(fresh)
  return fresh
}

// A sub-row's catNum can be different from its parent's (e.g. "01" sub under
// a "001" parent). Resolve by label-key first, then fall back to the closest
// matching parent's catNum.
function labelKeyForSubRow(head: string | undefined, rows: BudgetRow[], catNum: string | undefined): string {
  // First: see if any parent row matches the sub-row's category-NUMBER prefix.
  const norm = (s: string) => (s ?? '').replace(/^0+/, '')
  const target = norm(catNum ?? '')
  if (target) {
    for (const r of rows) {
      if (norm(r.catNum ?? '') === target) return labelKey(r.head)
    }
  }
  // Else fall back to the sub-row's own head text.
  return labelKey(head)
}
function partiesOf(cat: PayCategoryRaw, source: Src): PartyRaw[] { return (source === 'contractor' ? cat.contractors : cat.suppliers) ?? [] }
function sum<T>(arr: T[], f: (t: T) => number): number { return arr.reduce((s, t) => s + f(t), 0) }
function projectSort(a: ProjectNode, b: ProjectNode): number { return a.status !== b.status ? (a.status === 'open' ? -1 : 1) : a.name.localeCompare(b.name) }
