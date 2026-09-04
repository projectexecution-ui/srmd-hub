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
}

export interface TreeProject {
  id: string
  code: string | null
  name: string
  /** What the branch is called — the group label, else the code, else the name. */
  label: string
  children: TreeProject[]
}

/**
 * Fold a flat list into parents-with-children.
 *  - A child whose parent is missing (archived, or filtered out) is promoted to
 *    the top rather than vanishing — losing a project from the nav because its
 *    parent was archived would be silent and horrible to diagnose.
 *  - ONE level of nesting. The data allows deeper; the real hierarchy is two
 *    deep and a sidebar that nests further becomes unusable.
 *  - Sorted by code, then name, numerically aware, so the order is stable.
 */
export function buildProjectTree(projects: FlatProject[]): TreeProject[] {
  const byId = new Map(projects.map(p => [p.id, p]))
  const node = (p: FlatProject): TreeProject => ({
    id: p.id, code: p.code, name: p.name,
    label: (p.groupLabel?.trim() || p.code?.trim() || p.name).trim(),
    children: [],
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
  for (const r of out) r.children.sort(sort)
  return out
}

/** Total projects in the tree, at any depth — for the lane's count badge. */
export function countTree(tree: TreeProject[]): number {
  return tree.reduce((n, t) => n + 1 + t.children.length, 0)
}

/** The project id a cost-control URL is on, or null — used to auto-open the branch. */
export function projectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/cost-control\/projects\/([0-9a-f-]{36})/i)
  return m ? m[1] : null
}
