// Budget vs Actual V2 — pure consolidation engine (SINGLE SOURCE).
//
// READ-ONLY over the BPH (budget) blob. Produces one grouped tree:
//   Group → Project (open/closed) → Category → Sub-Category
//
// Every number — Budget, WO/PO Approved, Paid, Balance, Used% — comes from the
// uploaded budget report itself (IN4 BPH: budget, woApproved, actual per line).
// There is NO contractor/supplier overlay and NO alias matching: those made the
// "Actual" untrue (most payment spend attached to no budget line, and the two
// "Paid" figures never reconciled). The budget report already carries its own
// Paid column per line, so that is the one source of truth here.
//
// Balance (= Budget − Paid) and Used% (= Paid ÷ Budget) are pure derivations,
// computed in the view layer from these three fields.

interface BudgetRow { head?: string; budget?: number; approved?: number; actual?: number; woApproved?: number; catNum?: string; subNum?: string }
interface BudgetProjectRaw {
  name?: string; type?: string; parentId?: string | null
  areaStatement?: { builtUp?: number | null } | null
  data?: { rows?: BudgetRow[]; subRows?: BudgetRow[] } | null
}

export type StatusMap = Record<string, 'open' | 'closed'>
/** Per-project area override (overrides budget_hub_state.areaStatement.builtUp). */
export type AreaOverrideMap = Record<string, number>
/** Extra projects that don't exist in BPH yet — V2 placeholders. Can carry
 *  hand-keyed numbers (e.g. Raj Uphaar, which isn't in the IN4 upload). */
export interface ExtraProject { name: string; group_name?: string | null; area_sft?: number | null; budget?: number | null; approved?: number | null; paid?: number | null }
/** Flagged correction to a project that DID come from the IN4 upload. Only the
 *  non-null figures are overridden; the uploaded value is kept underneath. */
export interface OverrideRow { budget: number | null; approved: number | null; paid: number | null; note?: string | null; updated_at?: string | null }
export type OverrideMap = Record<string, OverrideRow>

// spent = the budget report's own Paid (BPH col21, "Total Paid Including Advance").
// approved = WO/PO/Misc Approved (BPH col5). Both roll up from the leaf rows.
export interface SubCatNode { code: string; label: string; budget: number; approved: number; spent: number }
export interface CatNode { code: string; label: string; budget: number; approved: number; spent: number; hasBudget: boolean; subcats: SubCatNode[] }
/** manual/uploaded carry the flagged-override state: which of budget/approved/spent
 *  were manually set, and (for corrections) the original uploaded values. */
export interface ManualFlags { budget?: boolean; approved?: boolean; spent?: boolean }
export interface ProjectNode {
  name: string; group: string; status: 'open' | 'closed'; area: number | null
  budget: number; approved: number; spent: number; categories: CatNode[]
  /** true when the project itself is hand-added (not from the IN4 upload). */
  isExtra?: boolean
  /** which figures are manually set (override or hand-keyed). */
  manual?: ManualFlags
  /** original uploaded figures, kept when a correction overrides them. */
  uploaded?: { budget: number; approved: number; spent: number }
  manualNote?: string | null
  manualAt?: string | null
}
export interface GroupNode { name: string; budget: number; approved: number; spent: number; area: number; projects: ProjectNode[] }
export interface ComposeResult {
  groups: GroupNode[]
  totals: { budget: number; approved: number; spent: number; area: number }
}

/** Flat totals used for weekly snapshots + week-over-week deltas. */
export interface ProjTotals { budget: number; approved: number; spent: number }
export interface SnapshotTotals { overall: ProjTotals; projects: Record<string, ProjTotals> }

const num = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0)
// A row's Approved is BPH's woApproved (col5). Fall back to an `approved` alias
// if a future upload names it that; 0 if neither is present.
const approvedOf = (r: BudgetRow): number => num(r.woApproved ?? r.approved)
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

export function composeBudgetV2(
  budgetProjects: BudgetProjectRaw[],
  status: StatusMap,
  /** Per-project area override (V2-owned). When set, beats budget_hub_state.areaStatement.builtUp. */
  areaOverrides: AreaOverrideMap = {},
  /** Extra V2-owned projects/groups that don't exist in BPH yet. */
  extras: ExtraProject[] = [],
  /** Flagged corrections to uploaded projects (Budget/Approved/Paid). */
  overrides: OverrideMap = {},
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
    // Apply a flagged correction (keeps the uploaded value underneath).
    applyOverride(node, overrides[p.name!])
    projectByName.set(p.name, node)
    const gk = node.group
    if (!projectsByGroup.has(gk)) projectsByGroup.set(gk, [])
    projectsByGroup.get(gk)!.push(node)
  }
  // V2-owned EXTRA projects: hand-added, may carry hand-keyed numbers (e.g. Raj
  // Uphaar). Status + area + group + numbers all come from this table.
  for (const ex of extras) {
    if (!ex.name) continue
    if (projectByName.has(ex.name)) continue // BPH wins if a project already exists
    const gname = (ex.group_name ?? '').trim() || '— Ungrouped'
    const area = typeof ex.area_sft === 'number' && ex.area_sft > 0 ? ex.area_sft : null
    const node: ProjectNode = {
      name: ex.name, group: gname,
      status: status[ex.name] ?? 'open',
      area: areaOverrides[ex.name] ?? area,
      budget: num(ex.budget), approved: num(ex.approved), spent: num(ex.paid), categories: [],
      isExtra: true,
      manual: { budget: ex.budget != null, approved: ex.approved != null, spent: ex.paid != null },
    }
    projectByName.set(ex.name, node)
    if (!projectsByGroup.has(gname)) projectsByGroup.set(gname, [])
    projectsByGroup.get(gname)!.push(node)
  }

  const groups: GroupNode[] = Array.from(projectsByGroup.entries())
    .map(([gname, projs]) => {
      projs.sort(projectSort)
      return {
        name: gname, projects: projs,
        budget: sum(projs, p => p.budget), approved: sum(projs, p => p.approved),
        spent: sum(projs, p => p.spent), area: sum(projs, p => p.area ?? 0),
      }
    })
    .sort((a, b) => (a.name === '— Ungrouped' ? 1 : b.name === '— Ungrouped' ? -1 : a.name.localeCompare(b.name)))

  return {
    groups,
    totals: {
      budget: sum(groups, g => g.budget), approved: sum(groups, g => g.approved),
      spent: sum(groups, g => g.spent), area: sum(groups, g => g.area),
    },
  }
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
    const c = cats.get(key) ?? { code: code || key, label: cleanLabel, budget: 0, approved: 0, spent: 0, hasBudget: true, subcats: [] }
    // Prefer the unmarked label + lowest numeric code as the display.
    if (!catMarker(c.label) && !catMarker(row.head)) {
      if (cleanLabel.length < c.label.length || (cleanLabel === c.label && code && (!c.code || code.length < c.code.length))) c.label = cleanLabel
    } else if (catMarker(c.label) && !catMarker(row.head)) {
      c.label = cleanLabel
    }
    if (code && (!c.code || (code.replace(/^0+/, '').length < c.code.replace(/^0+/, '').length))) c.code = code
    c.budget += num(row.budget); c.approved += approvedOf(row); c.spent += num(row.actual); c.hasBudget = true
    cats.set(key, c)
  }
  for (const sr of p.data?.subRows ?? []) {
    // Sub-rows attach by label-key so they land on the merged parent.
    const key = labelKeyForSubRow(sr.head, p.data?.rows ?? [], sr.catNum)
    let c = cats.get(key)
    if (!c) { c = { code: String(sr.catNum ?? ''), label: splitCode(sr.head).label || 'Other', budget: 0, approved: 0, spent: 0, hasBudget: true, subcats: [] }; cats.set(key, c) }
    const { code, label } = splitCode(sr.head)
    c.subcats.push({ code: code || (sr.subNum ?? ''), label, budget: num(sr.budget), approved: approvedOf(sr), spent: num(sr.actual) })
  }
  const categories = Array.from(cats.values()).sort((a, b) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true }))
  return {
    name: p.name!, group,
    status: status[p.name!] ?? 'open',
    area: typeof p.areaStatement?.builtUp === 'number' && p.areaStatement.builtUp > 0 ? p.areaStatement.builtUp : null,
    budget: sum(categories, c => c.budget), approved: sum(categories, c => c.approved), spent: sum(categories, c => c.spent), categories,
  }
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
function sum<T>(arr: T[], f: (t: T) => number): number { return arr.reduce((s, t) => s + f(t), 0) }
function projectSort(a: ProjectNode, b: ProjectNode): number { return a.status !== b.status ? (a.status === 'open' ? -1 : 1) : a.name.localeCompare(b.name) }

// Apply a flagged correction to an uploaded project. Only the non-null figures
// change; the original uploaded values are stashed in node.uploaded and the
// affected figures are flagged so the UI can badge them "manually adjusted".
function applyOverride(node: ProjectNode, ov: OverrideRow | undefined): void {
  if (!ov) return
  const touched = ov.budget != null || ov.approved != null || ov.paid != null
  if (!touched) return
  node.uploaded = { budget: node.budget, approved: node.approved, spent: node.spent }
  node.manual = {}
  if (ov.budget != null) { node.budget = ov.budget; node.manual.budget = true }
  if (ov.approved != null) { node.approved = ov.approved; node.manual.approved = true }
  if (ov.paid != null) { node.spent = ov.paid; node.manual.spent = true }
  node.manualNote = ov.note ?? null
  node.manualAt = ov.updated_at ?? null
}

// ─── Weekly snapshot + week-over-week deltas ─────────────────────────────────
/** Flatten the composed tree into per-project + overall totals for a snapshot. */
export function snapshotOf(result: ComposeResult): SnapshotTotals {
  const projects: Record<string, ProjTotals> = {}
  for (const g of result.groups) for (const p of g.projects) {
    projects[p.name] = { budget: p.budget, approved: p.approved, spent: p.spent }
  }
  return {
    overall: { budget: result.totals.budget, approved: result.totals.approved, spent: result.totals.spent },
    projects,
  }
}

export interface Delta { budget: number; approved: number; paid: number }
export interface DeltaResult { overall: Delta; byProject: Record<string, Delta>; hasBaseline: boolean }
/** current − previous, per project + overall. When prev is null there's no
 *  baseline yet (first week), so every delta is 0 and hasBaseline is false. */
export function deltaVs(result: ComposeResult, prev: SnapshotTotals | null): DeltaResult {
  const cur = snapshotOf(result)
  const d = (a: ProjTotals, b?: ProjTotals): Delta => ({
    budget: a.budget - (b?.budget ?? 0), approved: a.approved - (b?.approved ?? 0), paid: a.spent - (b?.spent ?? 0),
  })
  const byProject: Record<string, Delta> = {}
  if (prev) for (const name of Object.keys(cur.projects)) byProject[name] = d(cur.projects[name], prev.projects[name])
  return {
    overall: prev ? d(cur.overall, prev.overall) : { budget: 0, approved: 0, paid: 0 },
    byProject,
    hasBaseline: !!prev,
  }
}
