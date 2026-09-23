// The project tree for the side pane.
//
// `projects.parent_project_id` carries the tree. Since 23 Sep 2026 (Aksha,
// H1) it has three fixed levels — Group → Project → Sub-project — so the
// tree nests to any depth the data has, instead of flattening a third level
// up to the roots as it did when two levels were the rule.
//
// Pure; tested in project-tree.test.ts.

export interface FlatProject {
  id: string
  code: string | null
  name: string
  parentId: string | null
  groupLabel?: string | null
  /** From shell_for: a budget line or a working sheet of its own. A parent
   *  WITHOUT it is a pure grouping anchor (NGH, P2, VV, RU) and is drawn as a
   *  band, not a row. */
  hasOwnData?: boolean
}

export interface TreeProject {
  id: string
  code: string | null
  name: string
  label: string
  children: TreeProject[]
  /** A pure grouping anchor: has children and no data of its own. */
  anchor: boolean
}

export function buildProjectTree(projects: FlatProject[]): TreeProject[] {
  const byId = new Map(projects.map(p => [p.id, p]))
  const nodes = new Map<string, TreeProject>()
  const node = (p: FlatProject): TreeProject => {
    const existing = nodes.get(p.id)
    if (existing) return existing
    const n: TreeProject = {
      id: p.id, code: p.code, name: p.name,
      label: (p.groupLabel?.trim() || p.code?.trim() || p.name).trim(),
      children: [],
      anchor: false,
    }
    nodes.set(p.id, n)
    return n
  }
  const roots: TreeProject[] = []
  for (const p of projects) {
    const n = node(p)
    if (p.parentId && byId.has(p.parentId)) node(byId.get(p.parentId)!).children.push(n)
    else roots.push(n)
  }
  const sort = (a: TreeProject, b: TreeProject) => (a.code ?? a.name).localeCompare(b.code ?? b.name, undefined, { numeric: true })
  const finish = (n: TreeProject) => {
    n.children.sort(sort)
    n.anchor = n.children.length > 0 && byId.get(n.id)?.hasOwnData === false
    for (const c of n.children) {
      // A child whose code repeats the group label ("NGH" under NGH) is
      // labelled by its name ("NGH Infra") — code untouched.
      if (c.label === n.label) c.label = c.name
      finish(c)
    }
  }
  roots.sort(sort)
  for (const r of roots) finish(r)
  return roots
}

/** Projects in the tree, at any depth — for the lane's count badge. Anchors
 *  are bands, not projects, so they are not counted. */
export function countTree(tree: TreeProject[]): number {
  return tree.reduce((n, t) => n + (t.anchor ? 0 : 1) + countTree(t.children), 0)
}

export function projectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/(?:cost-control\/projects|project)\/([0-9a-f-]{36})/i)
  return m ? m[1] : null
}
