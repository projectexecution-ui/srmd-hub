// Admin-defined sidebar GROUPS — let an admin nest chosen modules under a
// name of their choice, so the side pane reads as a collapsible tree instead
// of one long flat list. Pure metadata in app_settings (key 'sidebar_groups');
// modules NOT placed in a group stay top-level. A group with no visible members
// (for a given role) simply doesn't render — so grouping never hides access.
//
// This file is PURE (no server imports) so client components (NavBar, the
// editor) can import the types + helpers. The DB read lives in
// `sidebar-groups.server.ts`.

export interface SidebarGroup {
  /** stable id (used for the open/closed memory) */
  id: string
  /** the name the admin typed — shown as the branch header */
  name: string
  /** module slugs nested under this group, in order */
  slugs: string[]
}

export const SIDEBAR_GROUPS_KEY = 'sidebar_groups'

/** Sanitise whatever is in the setting into a well-formed group list. */
export function parseSidebarGroups(raw: unknown): SidebarGroup[] {
  let val = raw
  if (typeof raw === 'string') { try { val = JSON.parse(raw) } catch { return [] } }
  if (!Array.isArray(val)) return []
  const out: SidebarGroup[] = []
  const seenIds = new Set<string>()
  for (const g of val) {
    if (!g || typeof g !== 'object') continue
    const name = typeof (g as any).name === 'string' ? (g as any).name.trim() : ''
    if (!name) continue
    let id = typeof (g as any).id === 'string' && (g as any).id ? (g as any).id : name
    while (seenIds.has(id)) id = id + '_'
    seenIds.add(id)
    const slugs = Array.isArray((g as any).slugs)
      ? (g as any).slugs.filter((s: unknown): s is string => typeof s === 'string')
      : []
    out.push({ id, name, slugs })
  }
  return out
}

/**
 * Pure builder: fold a flat list of nav links into { groups, ungrouped }.
 * - Only links present in `links` are placed (so permission-filtering upstream
 *   is respected and an empty group falls away).
 * - A slug can live in at most ONE group (first group that claims it wins).
 * - `ungrouped` keeps the original order of everything not claimed.
 */
export function buildNavTree<T extends { slug: string | null }>(
  links: T[],
  groups: SidebarGroup[],
): { groups: Array<{ id: string; name: string; items: T[] }>; ungrouped: T[] } {
  const bySlug = new Map<string, T>()
  for (const l of links) if (l.slug) bySlug.set(l.slug, l)
  const claimed = new Set<string>()
  const outGroups: Array<{ id: string; name: string; items: T[] }> = []
  for (const g of groups) {
    const items: T[] = []
    for (const slug of g.slugs) {
      const l = bySlug.get(slug)
      if (l && !claimed.has(slug)) { items.push(l); claimed.add(slug) }
    }
    if (items.length) outGroups.push({ id: g.id, name: g.name, items })
  }
  const ungrouped = links.filter(l => !l.slug || !claimed.has(l.slug))
  return { groups: outGroups, ungrouped }
}
