// The project hierarchy for the sidebar's Projects lane.
//
// `projects.parent_project_id` already carries the tree — NGH holds NGH A/B/C,
// P2 holds the towers, VV holds VINAY and VIVEK. The sidebar showed none of it
// and the Internal Estimate list flattened it, so a 41-project portfolio read
// as one long list. Pure — no React, no Supabase — so the shaping is unit-
// tested rather than eyeballed in the browser. (Carried over from the revamp
// trial branch, where it was written and tested.)

export interface FlatProject {
  id: string
  code: string | null
  name: string
  parentId: string | null
  /** Admin's group name on a parent, when set (e.g. "NGH" on the NGH Infra row). */
  groupLabel?: string | null
  /**
   * Carries Cost Control data of its own — a budget line or a working sheet
   * (shell_for, 16 Sep 2026). Decides whether a parent is a GROUP or a PROJECT:
   * NGH / P2 / VV hold nothing themselves and are anchors; Admin Block holds
   * ₹1.43 Cr of its own and is a project that happens to have sub-projects.
   * Absent means unknown (an older shell) and is treated as true, because
   * hiding a project's money behind a roll-up is the failure this prevents.
   */
  hasOwnData?: boolean
}

export interface TreeProject {
  id: string
  code: string | null
  name: string
  /** What the branch is called — the group label, else the code, else the name. */
  label: string
  children: TreeProject[]
  /**
   * A pure grouping anchor: has children and no data of its own. Drawn as a
   * group (chevron, children in view, no page of its own worth landing on).
   * A parent with its own data is NOT an anchor — it is drawn as a project
   * row with its sub-projects folded behind a "+N".
   */
  anchor: boolean
}

/**
 * Fold a flat list into parents-with-children.
 *  - A child whose parent is missing (archived, or filtered out) is promoted to
 *    the top rather than vanishing — losing a project from the nav because its
 *    parent was archived would be silent and horrible to diagnose.
 *  - ONE level of nesting. The data allows deeper; the real hierarchy is two
 *    deep and a sidebar that nests further becomes unusable.
 *  - Sorted by code, then name, numerically aware, so the order is stable.
 *  - A child whose label would repeat its parent's ("NGH" under NGH, because
 *    NGH Infra's code is NGH) is labelled by its name instead. The code is
 *    left alone — renaming it would break the IN4 name-match.
 */
export function buildProjectTree(projects: FlatProject[]): TreeProject[] {
  const byId = new Map(projects.map(p => [p.id, p]))
  const node = (p: FlatProject): TreeProject => ({
    id: p.id, code: p.code, name: p.name,
    label: (p.groupLabel?.trim() || p.code?.trim() || p.name).trim(),
    children: [],
    anchor: false,
  })
  const roots = new Map<string, TreeProject>()
  const children: FlatProject[] = []
  for (const p of projects) {
    if (!p.parentId || !byId.has(p.parentId)) { if (!roots.has(p.id)) roots.set(p.id, node(p)) }
    else children.push(p)
  }
  for (const p of children) {
    const parent = roots.get(p.parentId!)
    if (parent) parent.children.push(node(p))
    else if (!roots.has(p.id)) roots.set(p.id, node(p))   // deeper than two levels → flatten up
  }
  const sort = (a: TreeProject, b: TreeProject) => (a.code ?? a.name).localeCompare(b.code ?? b.name, undefined, { numeric: true })
  const out = [...roots.values()].sort(sort)
  for (const r of out) {
    r.children.sort(sort)
    r.anchor = r.children.length > 0 && byId.get(r.id)?.hasOwnData === false
    for (const c of r.children) if (c.label === r.label) c.label = c.name
  }
  return out
}

/** Projects in the tree, at any depth — for the lane's count badge. Anchors
 *  are not projects (NGH, P2, VV hold nothing), so they are not counted. */
export function countTree(tree: TreeProject[]): number {
  return tree.reduce((n, t) => n + (t.anchor ? 0 : 1) + t.children.length, 0)
}

/** The project id an Internal Estimate or cockpit URL is on, or null — used to auto-open the branch. */
export function projectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/(?:cost-control\/projects|project)\/([0-9a-f-]{36})/i)
  return m ? m[1] : null
}
