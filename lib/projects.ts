/**
 * Projects, arranged the way people say them.
 *
 * CT Hub has 45 projects and 30 of them sit under one of 9 parents, which the
 * database has always known (`parent_project_id`) and every picker in the app
 * used to ignore. Flat and alphabetical, "NGH B" sat between "NGH A" and
 * "NGH C" while "New Guest House - Common Expenses" — the same building — was
 * filed twenty lines away under N.
 *
 * Pure, so the order is tested rather than eyeballed, and shared, so the
 * Stores lane and Bills Booking and Cost Control cannot drift apart.
 */

export interface ProjectOpt {
  id: string
  name: string
  /** The heading this project sits under in a picker. */
  group: string
}

/** Standalone projects — no parent, no children — go last, under this. */
export const UNGROUPED = 'On their own'

/**
 * Order projects so a picker can walk the array and open a new heading
 * whenever `group` changes.
 *
 * A parent heads its own group and is the first option inside it, because
 * "NGH" is itself a bookable project and not only a heading. A project whose
 * parent has been deleted falls back to UNGROUPED rather than vanishing — an
 * option that silently disappears is how material gets booked to the wrong
 * site.
 */
export function groupProjects(
  rows: ReadonlyArray<{ id: string; name: string; parentId: string | null }>,
): ProjectOpt[] {
  const nameById = new Map(rows.map(r => [r.id, r.name]))
  const hasKids = new Set(rows.map(r => r.parentId).filter(Boolean) as string[])

  const opts: ProjectOpt[] = rows.map(r => ({
    id: r.id,
    name: r.name,
    group: r.parentId
      ? nameById.get(r.parentId) ?? UNGROUPED
      : hasKids.has(r.id) ? r.name : UNGROUPED,
  }))

  return opts.sort((a, b) => {
    if (a.group !== b.group) {
      if (a.group === UNGROUPED) return 1
      if (b.group === UNGROUPED) return -1
      return a.group.localeCompare(b.group)
    }
    // Inside a group: the parent first (it shares the group's name), then its
    // children by name.
    const aHead = a.name === a.group ? 0 : 1
    const bHead = b.name === b.group ? 0 : 1
    return aHead - bHead || a.name.localeCompare(b.name)
  })
}

/**
 * The same thing, straight off rows as the database hands them over —
 * `id, name, parent_project_id` — which is what every caller actually selects.
 * `code` rides along as the hint, so two projects with the same name can still
 * be told apart.
 */
export function groupProjectRows(
  rows: ReadonlyArray<{ id: string; name: string | null; parent_project_id?: string | null; code?: string | null }> | null,
): Array<ProjectOpt & { code: string | null }> {
  const clean = (rows ?? []).map(r => ({
    id: r.id,
    name: (r.name ?? '').trim(),
    parentId: r.parent_project_id ?? null,
    code: r.code ?? null,
  }))
  const codeById = new Map(clean.map(r => [r.id, r.code]))
  return groupProjects(clean).map(o => ({ ...o, code: codeById.get(o.id) ?? null }))
}
