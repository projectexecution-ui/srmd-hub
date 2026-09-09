// Permissions for the revamp — every workspace tab and every sub-pill under
// it can be switched per role, on top of the module permissions the screens
// themselves check. Pure; tested; no new table.
//
// Aksha, 10 Sep 2026: "make the Permission Matrix as per the revamp … remove
// the old modules we are not using … give the flexibility of every sub pill
// of the sections of the new view along with the main sections."
//
// How it is stored — in role_permissions, the table the matrix already
// writes, under slugs of its own:
//     ws:budget                  the Budget tab
//     ws:budget:by-order         its "By order" pill
//     ws:wo-po                   the WO / PO tab
//     ws:wo-po:boq-upload        its "BOQ upload" pill
// module_slug is free text and my_permissions()/my_shell() return every row
// for the person's effective role, so nothing in the database changes.
//
// How it is read — INHERITANCE, so day one behaves exactly like today:
//   · a tab with no ws row inherits its module (Budget ← cost-control, Indents
//     ← procurement-tracker …), which is precisely how the ribbon gated
//     before this file existed;
//   · a sub-pill with no ws row inherits its tab;
//   · a ws row, once written, decides — and only View is meaningful on a tab
//     or pill (can this role OPEN it). What a role can DO inside is still the
//     module's Edit / Admin, because that is what every screen checks.
//   · a module switched off portal-wide (module_visibility) hides its tabs
//     regardless — the matrix never widens what a switch has closed.

import { WORKSPACE_TABS, SETUP_TAB, RIBBON_GROUPS, type WorkspaceTab } from './workspace'

export type PermLike = Record<string, { view?: boolean; edit?: boolean; admin?: boolean } | undefined>

export const WS_PREFIX = 'ws:'
export const kebab = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
/** The tab's key in a slug: its URL segment, or "budget" for the index. */
export const tabKey = (tab: Pick<WorkspaceTab, 'slug'>) => tab.slug || 'budget'
export const tabSlug = (tab: Pick<WorkspaceTab, 'slug'>) => `${WS_PREFIX}${tabKey(tab)}`
export const subSlug = (tab: Pick<WorkspaceTab, 'slug'>, sub: string) => `${WS_PREFIX}${tabKey(tab)}:${kebab(sub)}`
export const isWsSlug = (slug: string) => slug.startsWith(WS_PREFIX)

/** Every tab the matrix knows: the fifteen plus Setup. */
export const ALL_TABS: WorkspaceTab[] = [...WORKSPACE_TABS, SETUP_TAB]

export interface TabAccess { view: boolean; source: 'tab' | 'module' }

/** May this role open the tab? An explicit ws row decides; otherwise the tab's module does, as before. */
export function tabAccess(perms: PermLike, tab: WorkspaceTab): TabAccess {
  const own = perms[tabSlug(tab)]
  if (own && typeof own.view === 'boolean') return { view: own.view, source: 'tab' }
  // An unbuilt tab shows no data, so it hangs off being in the cockpit at all
  // (cost-control) — the same rule visibleWorkspaceTabs applied.
  const moduleSlug = tab.built ? tab.permissionSlug : 'cost-control'
  return { view: perms[moduleSlug]?.view === true, source: 'module' }
}

/** May this role open one pill of the tab? Needs the tab; hidden only by an explicit ws row saying so. */
export function subAccess(perms: PermLike, tab: WorkspaceTab, sub: string): boolean {
  if (!tabAccess(perms, tab).view) return false
  const own = perms[subSlug(tab, sub)]
  return own && typeof own.view === 'boolean' ? own.view : true
}

/** Indices of the pills this role may open, in the tab's order. */
export function allowedSubs(perms: PermLike, tab: WorkspaceTab): number[] {
  return tab.subs.map((s, i) => (subAccess(perms, tab, s) ? i : -1)).filter(i => i >= 0)
}

/** The pill to land on: the asked-for one if allowed, else the first allowed; -1 when none is. */
export function landingSub(perms: PermLike, tab: WorkspaceTab, asked: number): number {
  const ok = allowedSubs(perms, tab)
  if (tab.subs.length === 0) return 0
  if (ok.includes(asked)) return asked
  return ok.length ? ok[0] : -1
}

/** The ribbon's rule, with tab rows honoured: reviewer standing, the module switch, then access. */
export function canOpenWorkspaceTab(perms: PermLike, tab: WorkspaceTab, disabled: Set<string> | string[], isReviewer: boolean): boolean {
  const off = disabled instanceof Set ? disabled : new Set(disabled)
  if (tab.reviewerOnly && !isReviewer) return false
  if (off.has(tab.built ? tab.permissionSlug : 'cost-control')) return false
  return tabAccess(perms, tab).view
}

export function visibleWorkspaceTabsV2(perms: PermLike, disabled: Set<string> | string[], isReviewer: boolean): WorkspaceTab[] {
  return WORKSPACE_TABS.filter(t => canOpenWorkspaceTab(perms, t, disabled, isReviewer))
}

/** For the ribbon: which pill indices each visible tab may show. */
export function allowedSubsByTab(perms: PermLike, tabs: readonly WorkspaceTab[]): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const t of tabs) out[t.slug] = allowedSubs(perms, t)
  return out
}

/* ── The matrix's rows ──────────────────────────────────────────────────── */

export type RowKind = 'module' | 'tab' | 'sub'
export interface MatrixRow {
  slug: string
  label: string
  kind: RowKind
  /** The row this one inherits from when it has no row of its own: a tab's module, a pill's tab. */
  inherits?: string
  /** Shown under the label: the module a tab hangs off, the tab a pill belongs to, a module's hint. */
  hint?: string
  /** Lucide icon name for tabs; modules resolve their own. */
  icon?: string
  /** For a pill: its tab's slug — the matrix indents it and hides it with the tab. */
  parent?: string
  /** True for a tab or module the reviewer flag also guards (Approvals, Accounts, Setup). */
  reviewerOnly?: boolean
  /** An unbuilt tab: greyed in the ribbon, carries no data. */
  unbuilt?: boolean
}
export interface MatrixSection { id: string; title: string; note?: string; rows: MatrixRow[] }

/**
 * The modules the revamp still stands on — what a role can DO inside the
 * workspace and on the few lanes that stay top-level. Everything else in
 * lib/modules.ts is an old screen the revamp replaced or parked (see
 * lib/revamp/nav.ts) and goes to the collapsed section at the bottom.
 */
export const REVAMP_MODULES: Array<{ slug: string; hint: string }> = [
  { slug: 'cost-control',        hint: 'The projects lane, Budget, Approvals, Accounts, Discussions, Masters and Setup — Edit raises and acts on budgets' },
  { slug: 'budget-vs-actual-v2', hint: 'SC Budget — top-management report' },
  { slug: 'procurement-tracker', hint: 'Indents and WO / PO — live from IN4' },
  { slug: 'warehouse',           hint: 'Material In-Out — Edit moves stock' },
  { slug: 'jmr',                 hint: 'JMR — Edit logs a day, Admin approves' },
  { slug: 'contractor-report',   hint: 'Reports tab — contractor billing' },
  { slug: 'supplier-report',     hint: 'Reports tab — supplier billing' },
  { slug: 'bills-pipeline',      hint: 'Bills lane — the ERP team’s weekly SRA / SRET work' },
  { slug: 'stuck-bills',         hint: 'Bills lane — the stuck-bills checklist' },
  { slug: 'approvals',           hint: 'My Approvals inbox' },
  { slug: 'admin-users',         hint: 'Users, roles and the allowlist' },
  { slug: 'admin-permissions',   hint: 'This matrix' },
  { slug: 'admin-settings',      hint: 'Portal settings, notifications, IN4' },
]
export const REVAMP_MODULE_SLUGS = new Set(REVAMP_MODULES.map(m => m.slug))

export interface ModuleRef { slug: string; label: string }

/** The sections the admin screen shows: the workspace (tab rows with their pills), the modules the revamp uses, and the old screens apart. */
export function buildMatrixSections(modules: readonly ModuleRef[]): { sections: MatrixSection[]; legacy: MatrixSection } {
  const moduleLabel = (slug: string) => modules.find(m => m.slug === slug)?.label ?? slug
  const sections: MatrixSection[] = []
  for (const g of RIBBON_GROUPS) {
    const rows: MatrixRow[] = []
    for (const t of WORKSPACE_TABS.filter(t => t.group === g.id)) {
      const moduleSlug = t.built ? t.permissionSlug : 'cost-control'
      rows.push({
        slug: tabSlug(t), label: t.label, kind: 'tab', inherits: moduleSlug, icon: t.icon, reviewerOnly: t.reviewerOnly, unbuilt: !t.built,
        hint: `${t.built ? '' : 'coming soon · '}inherits ${moduleLabel(moduleSlug)}`,
      })
      for (const s of t.subs) rows.push({ slug: subSlug(t, s), label: s, kind: 'sub', inherits: tabSlug(t), parent: tabSlug(t), hint: `${t.ribbon} · pill` })
    }
    sections.push({ id: `ws-${g.id}`, title: `Project workspace — ${g.label}`, rows })
  }
  sections.push({
    id: 'ws-setup', title: 'Project workspace — Setup',
    note: 'The gear beside the sync stamp. Cost Control reviewers only, on top of this switch.',
    rows: [{ slug: tabSlug(SETUP_TAB), label: SETUP_TAB.label, kind: 'tab', inherits: 'cost-control', icon: SETUP_TAB.icon, reviewerOnly: true, hint: `inherits ${moduleLabel('cost-control')}` }],
  })
  sections.push({
    id: 'modules', title: 'Screens and powers',
    note: 'What a role can DO. Edit and Admin here are what the screens check inside a tab; a tab above inherits View from its module until it has a switch of its own.',
    rows: REVAMP_MODULES.filter(m => modules.some(x => x.slug === m.slug)).map(m => ({ slug: m.slug, label: moduleLabel(m.slug), kind: 'module' as const, hint: m.hint })),
  })
  const legacy: MatrixSection = {
    id: 'legacy', title: 'Old screens — not in the revamp',
    note: 'Replaced by a tab or parked (lib/revamp/nav.ts). Still routable by URL, so their switches still matter; kept here, folded away.',
    rows: modules.filter(m => !REVAMP_MODULE_SLUGS.has(m.slug)).map(m => ({ slug: m.slug, label: m.label, kind: 'module' as const })),
  }
  return { sections, legacy }
}

/** Every ws slug the matrix can write — used to prove they are unique and well-formed. */
export function allWsSlugs(): string[] {
  return ALL_TABS.flatMap(t => [tabSlug(t), ...t.subs.map(s => subSlug(t, s))])
}

/** Rows that match a search: a tab keeps its pills, a matching pill keeps its tab. */
export function filterRows(rows: readonly MatrixRow[], q: string): MatrixRow[] {
  const s = q.trim().toLowerCase()
  if (!s) return [...rows]
  // A pill's hint names its tab, which would make every pill match the tab's name — so hints count for tabs and modules only.
  const hit = (r: MatrixRow) => r.label.toLowerCase().includes(s) || r.slug.toLowerCase().includes(s) || (r.kind !== 'sub' && (r.hint ?? '').toLowerCase().includes(s))
  const keep = new Set<string>()
  for (const r of rows) {
    if (!hit(r)) continue
    keep.add(r.slug)
    if (r.parent) keep.add(r.parent)
    if (r.kind === 'tab') for (const c of rows) if (c.parent === r.slug) keep.add(c.slug)
  }
  return rows.filter(r => keep.has(r.slug))
}
