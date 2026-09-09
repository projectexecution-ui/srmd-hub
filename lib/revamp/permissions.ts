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

/* ── The full set — View · Edit · Admin — with the same inheritance ─────── */

export interface Access { view: boolean; edit: boolean; admin: boolean }
const NONE: Access = { view: false, edit: false, admin: false }
const asAccess = (p: { view?: boolean; edit?: boolean; admin?: boolean } | undefined): Access => ({ view: !!p?.view, edit: !!p?.edit, admin: !!p?.admin })

/** The tab's three flags: its own row if it has one, else its power's (Aksha, 10 Sep 2026: "Edit and Admin on each tab and pill as the old modules had"). */
export function tabAccessFull(perms: PermLike, tab: WorkspaceTab): Access & { source: 'tab' | 'module' } {
  const own = perms[tabSlug(tab)]
  if (own && typeof own.view === 'boolean') return { ...asAccess(own), source: 'tab' }
  return { ...asAccess(perms[tab.built ? tab.permissionSlug : 'cost-control']), source: 'module' }
}

/** A pill's three flags: its own row if it has one (View still needs the tab), else the tab's. A closed tab closes everything under it. */
export function subAccessFull(perms: PermLike, tab: WorkspaceTab, sub: string): Access & { own: boolean } {
  const t = tabAccessFull(perms, tab)
  if (!t.view) return { ...NONE, own: false }
  const own = perms[subSlug(tab, sub)]
  if (own && typeof own.view === 'boolean') { const a = asAccess(own); return { view: a.view, edit: a.view && a.edit, admin: a.view && a.admin, own: true } }
  return { view: t.view, edit: t.edit, admin: t.admin, own: false }
}

/**
 * The permission map a tab's screen should render with: the tab's power
 * (cost-control, procurement-tracker …) replaced by what THIS tab — and, when
 * it has pills, this pill — grants. So "Edit off on Budget" hides the raise /
 * act controls on Budget while Discussions, on the same power, keeps them.
 * Applied per server render of the tab (lib/auth.ts scopePermissions); a
 * server action is its own request and still checks the power itself.
 */
export function scopedPerms<T extends PermLike>(perms: T, tab: WorkspaceTab, subIndex: number): T {
  const moduleSlug = tab.built ? tab.permissionSlug : 'cost-control'
  const a = tab.subs.length ? subAccessFull(perms, tab, tab.subs[subIndex] ?? tab.subs[0]) : tabAccessFull(perms, tab)
  return { ...perms, [moduleSlug]: { view: a.view, edit: a.edit, admin: a.admin } }
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
 * THE POWERS — what a role can DO, in the revamp's own words. Each is the
 * permission slug the revamp's screens check (Edit raises a budget, Admin
 * approves a JMR…), named for what it powers now, never for the old module
 * screen it came from. This list, not lib/modules.ts, is what the matrix is
 * built from — Aksha, 10 Sep 2026: "I don't want other modules in
 * Permissions … without keeping any old module to be imported to new ones."
 * When the old screens are removed after approval, nothing here changes.
 */
export interface Power { slug: string; label: string; hint: string; lane: 'workspace' | 'portal' }
export const POWERS: Power[] = [
  { slug: 'cost-control',        lane: 'workspace', label: 'Projects',        hint: 'The projects lane and the workspace itself — Budget, Approvals, Accounts, Discussions, Masters, Setup. Edit raises and acts on budgets; Admin manages projects.' },
  { slug: 'procurement-tracker', lane: 'workspace', label: 'Procurement',     hint: 'Indents and WO / PO, live from IN4.' },
  { slug: 'warehouse',           lane: 'workspace', label: 'Material In-Out', hint: 'Stores and gate entries. Edit moves stock.' },
  { slug: 'jmr',                 lane: 'workspace', label: 'JMR',             hint: 'Edit logs a day; Admin approves.' },
  { slug: 'budget-vs-actual-v2', lane: 'workspace', label: 'SC Budget',       hint: 'The top-management report.' },
  { slug: 'contractor-report',   lane: 'workspace', label: 'Reports — contractors', hint: 'Contractor billing on the Reports tab.' },
  { slug: 'supplier-report',     lane: 'workspace', label: 'Reports — suppliers',   hint: 'Supplier billing on the Reports tab.' },
  { slug: 'bills-pipeline',      lane: 'portal',    label: 'Bills',           hint: 'The Bills lane — the ERP team’s weekly SRA / SRET work.' },
  { slug: 'stuck-bills',         lane: 'portal',    label: 'Bills — stuck bills', hint: 'The stuck-bills checklist.' },
  { slug: 'approvals',           lane: 'portal',    label: 'My Approvals',    hint: 'The approvals inbox.' },
  { slug: 'admin-users',         lane: 'portal',    label: 'Admin — users & roles', hint: 'Users, roles, the allowlist.' },
  { slug: 'admin-permissions',   lane: 'portal',    label: 'Admin — permissions',   hint: 'This matrix.' },
  { slug: 'admin-settings',      lane: 'portal',    label: 'Admin — settings',      hint: 'Portal settings, notifications, IN4.' },
]
export const POWER_SLUGS = new Set(POWERS.map(m => m.slug))
export const powerLabel = (slug: string) => POWERS.find(p => p.slug === slug)?.label ?? slug

/** The sections the admin screen shows: the workspace (tab rows with their pills), then the powers. Nothing from the old module list. */
export function buildMatrixSections(): { sections: MatrixSection[] } {
  const sections: MatrixSection[] = []
  for (const g of RIBBON_GROUPS) {
    const rows: MatrixRow[] = []
    for (const t of WORKSPACE_TABS.filter(t => t.group === g.id)) {
      const moduleSlug = t.built ? t.permissionSlug : 'cost-control'
      rows.push({
        slug: tabSlug(t), label: t.label, kind: 'tab', inherits: moduleSlug, icon: t.icon, reviewerOnly: t.reviewerOnly, unbuilt: !t.built,
        hint: `${t.built ? '' : 'coming soon · '}inherits ${powerLabel(moduleSlug)}`,
      })
      for (const s of t.subs) rows.push({ slug: subSlug(t, s), label: s, kind: 'sub', inherits: tabSlug(t), parent: tabSlug(t), hint: `${t.ribbon} · pill` })
    }
    sections.push({ id: `ws-${g.id}`, title: `Project workspace — ${g.label}`, rows })
  }
  sections.push({
    id: 'ws-setup', title: 'Project workspace — Setup',
    note: 'The gear beside the sync stamp. Cost Control reviewers only, on top of this switch.',
    rows: [{ slug: tabSlug(SETUP_TAB), label: SETUP_TAB.label, kind: 'tab', inherits: 'cost-control', icon: SETUP_TAB.icon, reviewerOnly: true, hint: `inherits ${powerLabel('cost-control')}` }],
  })
  const power = (p: Power): MatrixRow => ({ slug: p.slug, label: p.label, kind: 'module', hint: p.hint })
  sections.push({
    id: 'powers-workspace', title: 'Powers — inside a project',
    note: 'What a role can DO on the tabs above. A tab inherits View from its power until it has a switch of its own; Edit and Admin are what the screens check.',
    rows: POWERS.filter(p => p.lane === 'workspace').map(power),
  })
  sections.push({
    id: 'powers-portal', title: 'Powers — portal lanes',
    note: 'Bills, My Approvals and Admin — the lanes that stay top-level.',
    rows: POWERS.filter(p => p.lane === 'portal').map(power),
  })
  return { sections }
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
