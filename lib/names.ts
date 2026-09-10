// The name layer, Phase 1 (Aksha, 10 Sep 2026): the few pure rules for what a
// screen SHOWS, kept apart from what the code MATCHES on.
//
// Identity is IN4's text and the project's code; display is a CT Hub choice
// stored beside it. Nothing in this file may be used as a key — a matcher that
// read a display name would move money when someone changed a label.

/** IN4 prefixes its category code onto the name: "03 Civil", "602 Fittings".
 *  People read "Civil"; the tree keeps the code as its SORT key. Also drops the
 *  "N Spl"-style abbreviations IN4 stores in short_name — those are not names. */
export function skillLabel(name: string | null | undefined): string {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim()
  return s.replace(/^\d{1,4}\s+(?=\S)/, '').trim() || s
}

/** The chip on a project: its short name when set, else its code. The code is
 *  still the code — Working-Sheet numbers and matching never see this. */
export function projectChip(shortName: string | null | undefined, code: string | null | undefined): string {
  const s = (shortName ?? '').trim()
  return s || (code ?? '').trim()
}

/** The band label over a group of projects: an explicit group label, else the
 *  group project's chip, else its name. Same chain as before with short_name
 *  slotted in after group_label, so nothing that reads a band today changes. */
export function groupBand(
  p: { group_label?: string | null; short_name?: string | null; code?: string | null; name?: string | null },
): string {
  return (p.group_label ?? '').trim() || projectChip(p.short_name, p.code) || (p.name ?? '').trim()
}

/* ── Phase 3: scoped display names (cthub_names) ──────────────────────────
 *
 * A name can be set for the whole app, for one module (a workspace tab such as
 * Indents or WO / PO), or for one project. The most specific wins:
 *
 *     project  →  module  →  everywhere  →  the fallback the caller passes
 *
 * The fallback is IN4's own text (through skillLabel) or the registry label.
 * Keys are stable ids, never text — a skill id, or the ws:… slug the permission
 * matrix already uses for tabs and pills. */

export type NameKind = 'skill' | 'tab' | 'pill'
export type NameScope = 'all' | 'module' | 'project'

export interface NameRow {
  kind: NameKind
  key: string
  scope: NameScope
  /** '' for 'all'; a module slug ('procurement', 'wo-po') or a project uuid otherwise. */
  scope_id: string
  display_name: string
  note?: string | null
  set_by?: string | null
  set_at?: string | null
}

export interface NameCtx {
  projectId?: string | null
  module?: string | null
}

/** Which scopes make sense for each kind. A material or a category can differ
 *  per project or per screen; a tab or pill is per project at most — "only in
 *  the Indents module" is meaningless for the Indents tab itself. */
export const SCOPES_FOR: Record<NameKind, NameScope[]> = {
  skill: ['all', 'module', 'project'],
  tab: ['all', 'project'],
  pill: ['all', 'project'],
}

/** The modules a category name can be scoped to — the workspace tabs that show
 *  IN4 categories. Slugs are the tabs' own. */
export const SKILL_MODULES: Array<{ slug: string; label: string }> = [
  { slug: 'procurement', label: 'Indents' },
  { slug: 'wo-po', label: 'WO / PO' },
]

export const skillKey = (id: number | string) => `skill:${id}`

/** Index rows by kind|key so a tree of 500 categories resolves in O(1) each. */
export function nameIndex(rows: readonly NameRow[]): Map<string, NameRow[]> {
  const m = new Map<string, NameRow[]>()
  for (const r of rows) {
    const k = `${r.kind}|${r.key}`
    const arr = m.get(k) ?? []
    arr.push(r)
    m.set(k, arr)
  }
  return m
}

/** The name to show, or null when nothing is set at any applicable scope. */
export function resolveName(index: Map<string, NameRow[]>, kind: NameKind, key: string, ctx: NameCtx = {}): NameRow | null {
  const rows = index.get(`${kind}|${key}`)
  if (!rows || rows.length === 0) return null
  const pick = (scope: NameScope, id: string) => rows.find(r => r.scope === scope && r.scope_id === id) ?? null
  if (ctx.projectId) { const r = pick('project', ctx.projectId); if (r) return r }
  if (ctx.module) { const r = pick('module', ctx.module); if (r) return r }
  return pick('all', '')
}

/** Convenience: the display text, else the fallback. */
export function shownOr(index: Map<string, NameRow[]>, kind: NameKind, key: string, ctx: NameCtx, fallback: string): string {
  return resolveName(index, kind, key, ctx)?.display_name ?? fallback
}
