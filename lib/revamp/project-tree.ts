// The project hierarchy for the sidebar's Projects lane.
//
// `projects.parent_project_id` already carries the tree — NGH holds NGH A/B/C,
// P2 holds the towers, VV holds VINAY and VIVEK. Today the sidebar shows none
// of it, and the Cost Control list flattens it, so a 39-project portfolio reads
// as one long list.
//
// Pure — no React, no Supabase — so the shaping is unit-tested rather than
// eyeballed in the browser.

export interface FlatProject {
  id: string
  code: string | null
  name: string
  parentId: string | null
}

export interface TreeProject {
  id: string
  code: string | null
  name: string
  children: TreeProject[]
}

/**
 * Fold a flat list into parents-with-children.
 *
 * Rules that matter:
 *  - A child whose parent is missing from the list (archived, or filtered out
 *    by permission) is promoted to the top rather than vanishing. Losing a
 *    project from the nav because its parent was archived would be silent and
 *    horrible to diagnose.
 *  - Only ONE level of nesting. The data allows deeper, but the real hierarchy
 *    is two deep and a sidebar that nests further becomes unusable.
 *  - Sorted by code, then name, so the order is stable between renders.
 */
export function buildProjectTree(projects: FlatProject[]): TreeProject[] {
  const byId = new Map(projects.map(p => [p.id, p]))
  const node = (p: FlatProject): TreeProject => ({ id: p.id, code: p.code, name: p.name, children: [] })

  const roots = new Map<string, TreeProject>()
  const orphansAndChildren: FlatProject[] = []

  for (const p of projects) {
    if (!p.parentId || !byId.has(p.parentId)) {
      // No parent, or a parent that is not visible → top level.
      if (!roots.has(p.id)) roots.set(p.id, node(p))
    } else {
      orphansAndChildren.push(p)
    }
  }

  for (const p of orphansAndChildren) {
    const parent = roots.get(p.parentId!)
    if (parent) {
      parent.children.push(node(p))
    } else {
      // Parent exists in the data but is itself a child (deeper than two
      // levels). Flatten to the top rather than dropping it.
      if (!roots.has(p.id)) roots.set(p.id, node(p))
    }
  }

  const sort = (a: TreeProject, b: TreeProject) =>
    (a.code ?? a.name).localeCompare(b.code ?? b.name, undefined, { numeric: true })

  const out = [...roots.values()].sort(sort)
  for (const r of out) r.children.sort(sort)
  return out
}

/** Total projects in the tree, at any depth — for the lane's count badge. */
export function countTree(tree: TreeProject[]): number {
  return tree.reduce((n, t) => n + 1 + t.children.length, 0)
}

/** The id of the project a cockpit URL is on, or null. Used to auto-open the
 *  branch containing whatever is on screen. */
export function projectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/project\/([0-9a-f-]{36})/i)
  return m ? m[1] : null
}
