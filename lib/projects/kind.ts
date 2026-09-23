// Three fixed levels: Group → Project → Sub-project.
//
// Aksha, 23 Sep 2026 (decision H1). Until now the hub allowed exactly one
// level of nesting and both pickers offered only top-level projects, so a
// building that already sat under a group anchor (NGH A under NGH, "Raj
// Uphaar - Execution" under RU) could never be a parent — and 28 cost-centre
// sub-projects (Common Expenses, Design, Security…) had nowhere to go but
// straight under the anchor.
//
//   Group        a programme that holds projects — NGH, P2, VV, RU. No
//                categories, approvers or estimate of its own.
//   Project      a building or scope with its own Internal Estimate —
//                NGH A, Admin Block, SRAH. May sit under a group or stand alone.
//   Sub-project  a part or cost centre of ONE project — Ground Floor,
//                Common Expenses, Design. Always under a project.
//
// Stored in projects.project_type ('group' | 'project' | 'subproject';
// 'individual' is the legacy spelling of 'project'). A database trigger
// holds the same rules; this file is the one place the words and the
// checks live for the app, and it is pure so they are tested.

export type ProjectKind = 'group' | 'project' | 'subproject'

export const KINDS: readonly ProjectKind[] = ['group', 'project', 'subproject']

export const KIND_LABEL: Record<ProjectKind, string> = {
  group: 'Group',
  project: 'Project',
  subproject: 'Sub-project',
}

export const KIND_HINT: Record<ProjectKind, string> = {
  group: 'A programme that holds projects — e.g. NGH, RU. No categories or approvers of its own.',
  project: 'A building or scope with its own Internal Estimate — e.g. NGH A, Admin Block.',
  subproject: 'A part or cost centre of one project — e.g. Ground Floor, Common Expenses, Design.',
}

/** What the database holds, read safely. 'individual' was the old word for project. */
export function kindOf(raw: string | null | undefined): ProjectKind {
  if (raw === 'group' || raw === 'subproject') return raw
  return 'project'
}

/** The kind a parent must have. A group has no parent; a project may have a
 *  group or none; a sub-project must have a project. */
export function parentKindFor(kind: ProjectKind): ProjectKind | null {
  return kind === 'group' ? null : kind === 'project' ? 'group' : 'project'
}

export function depthOf(kind: ProjectKind): 0 | 1 | 2 {
  return kind === 'group' ? 0 : kind === 'project' ? 1 : 2
}

export interface KindRow { id: string; kind: ProjectKind; parentId?: string | null }

/** The projects that may be picked as the parent of something of `kind`. */
export function allowedParents<T extends KindRow>(kind: ProjectKind, all: readonly T[], selfId?: string): T[] {
  const want = parentKindFor(kind)
  if (!want) return []
  return all.filter(p => p.kind === want && p.id !== selfId)
}

/** Why a (kind, parent) pair is not allowed, or null when it is. `parent` is
 *  null for top-level. A project may be top-level; a sub-project may not. */
export function parentError(kind: ProjectKind, parent: { kind: ProjectKind } | null): string | null {
  const want = parentKindFor(kind)
  if (kind === 'group') return parent ? 'A group is always top-level — it cannot sit under anything.' : null
  if (!parent) return kind === 'subproject' ? 'A sub-project must sit under a project. Pick one.' : null
  if (parent.kind !== want) {
    if (kind === 'project') return `A project can only sit under a group — “${KIND_LABEL[parent.kind].toLowerCase()}” is not one. Make it a sub-project if it belongs to that project.`
    return `A sub-project can only sit under a project — that one is a ${KIND_LABEL[parent.kind].toLowerCase()}.`
  }
  return null
}

/** Why a project cannot become `next`, given what already sits under it. */
export function kindChangeError(next: ProjectKind, childKinds: readonly ProjectKind[]): string | null {
  if (childKinds.length === 0) return null
  const need = parentKindFor(childKinds[0]) // all children share a kind by construction
  const mixed = childKinds.some(k => parentKindFor(k) !== need)
  if (mixed) return 'The things under this project are of two kinds — sort them out first.'
  if (need !== next) {
    return next === 'subproject'
      ? 'This has things under it — a sub-project cannot. Move them out first.'
      : `The things under this are ${KIND_LABEL[childKinds[0]].toLowerCase()}s, so this must stay a ${KIND_LABEL[need!].toLowerCase()}.`
  }
  return null
}

/** The kind a new thing under `parent` defaults to. */
export function childKindOf(parent: ProjectKind): ProjectKind | null {
  return parent === 'group' ? 'project' : parent === 'project' ? 'subproject' : null
}

/** For the one-time migration and for rows that predate the column: read the
 *  kind off the shape of the tree. A childless top-level row is a project. */
export function inferKind(p: { parentId: string | null; hasChildren: boolean; hasOwnData: boolean; parentKind?: ProjectKind | null }): ProjectKind {
  if (p.parentId) return p.parentKind === 'group' ? 'project' : 'subproject'
  if (p.hasChildren && !p.hasOwnData) return 'group'
  return 'project'
}

// ── Tree walks, pure ────────────────────────────────────────────────────

export interface TreeRow { id: string; parentId: string | null }

/** The top of the tree a row sits in (itself when top-level). */
export function topOf(id: string, byId: ReadonlyMap<string, TreeRow>): string {
  let cur = id
  for (let i = 0; i < 4; i++) {
    const p = byId.get(cur)?.parentId
    if (!p || !byId.has(p)) return cur
    cur = p
  }
  return cur
}

/** Everything under a row, any depth, in breadth-first order. */
export function descendants(id: string, all: readonly TreeRow[]): string[] {
  const kids = new Map<string, string[]>()
  for (const r of all) if (r.parentId) (kids.get(r.parentId) ?? kids.set(r.parentId, []).get(r.parentId)!).push(r.id)
  const out: string[] = []
  const queue = [...(kids.get(id) ?? [])]
  while (queue.length) {
    const x = queue.shift()!
    out.push(x)
    queue.push(...(kids.get(x) ?? []))
  }
  return out
}

/** "NGH › NGH A › Ground Floor" — the path down to a row, top first. */
export function pathOf(id: string, byId: ReadonlyMap<string, TreeRow & { label: string }>): string[] {
  const out: string[] = []
  let cur: string | undefined = id
  for (let i = 0; i < 4 && cur; i++) {
    const r = byId.get(cur)
    if (!r) break
    out.unshift(r.label)
    cur = r.parentId ?? undefined
  }
  return out
}
