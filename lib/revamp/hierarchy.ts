// Rolling a parent project up over its children.
//
// IN4 and CT Hub agree on the shape but not the level. "New Guest House" in an
// IN4 upload is the GROUP — the hub splits it into NGH A, NGH B, NGH C, NGH
// Infra and New Guest House - Common Expenses, all hanging off a parent called
// NGH. Same for P2 (Infra + A01/A02/A03 + the two common-expense projects) and
// VV (VINAY, VIVEK, VV Infra, Common Expenses).
//
// So opening the NGH cockpit has to show NGH *and everything under it*, or the
// group looks empty while its children hold all the money. That is exactly the
// "Master of Projects, all interlinked" the HOD asked for.
//
// Pure — no Supabase — so the traversal is unit-tested rather than trusted.

export interface HierarchyNode {
  id: string
  parentId: string | null
}

/**
 * A project plus every project beneath it, at any depth.
 *
 * Always includes the project itself, so callers can use the result as "the
 * set of ids this screen covers" without a special case for a leaf.
 *
 * Cycle-safe: a row whose parent chain loops (bad data, or a project made its
 * own ancestor) would otherwise hang the request forever.
 */
export function descendantIds(projects: HierarchyNode[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const p of projects) {
    if (!p.parentId) continue
    const list = childrenOf.get(p.parentId)
    if (list) list.push(p.id)
    else childrenOf.set(p.parentId, [p.id])
  }

  const out: string[] = []
  const seen = new Set<string>()
  const queue = [rootId]

  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    const kids = childrenOf.get(id)
    if (kids) queue.push(...kids)
  }

  return out
}

/** True when this project has anything beneath it — the screens use it to say
 *  "including its N sub-projects" rather than silently showing more than the
 *  project's own figures. */
export function hasChildren(projects: HierarchyNode[], id: string): boolean {
  return projects.some(p => p.parentId === id)
}

export function childCount(projects: HierarchyNode[], id: string): number {
  return descendantIds(projects, id).length - 1
}
