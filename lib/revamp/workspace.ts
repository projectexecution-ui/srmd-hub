// The project workspace shell — build order §1.
//
// Fifteen tabs, always all fifteen, in five groups: Money · Procurement ·
// Site · Documents · People. No overflow menu and no horizontal scrolling on
// a desktop, because a tab you cannot see is a tab nobody uses — the whole
// point of a workspace is that the project's fifteen faces are in view at once.
//
// Two levels of tab, never three: the ribbon, then a pill row of sub-tabs.
// Anything deeper is a view inside the page, not another tab.
//
// This is the ribbon's shape only. Which tabs a given person may open still
// comes from the permission matrix via `permissionSlug`, exactly as the old
// strip did — the shell can never widen anyone's access.

import { PROJECT_TABS, type ProjectTab } from './tabs'

export type RibbonGroup = 'money' | 'procurement' | 'site' | 'documents' | 'people'

export const RIBBON_GROUPS: Array<{ id: RibbonGroup; label: string }> = [
  { id: 'money',       label: 'Money' },
  { id: 'procurement', label: 'Procurement' },
  { id: 'site',        label: 'Site' },
  { id: 'documents',   label: 'Documents' },
  { id: 'people',      label: 'People' },
]

export interface WorkspaceTab {
  /** URL segment under /project/[id]. Empty string = the index (Budget). */
  slug: string
  /** The ≤2-word label under the icon in the ribbon. */
  ribbon: string
  /** The full name, used as the tab's title and as the page heading. */
  label: string
  group: RibbonGroup
  /** Lucide icon name, resolved in the client component. */
  icon: string
  /** The pill row under the ribbon. First entry is the default view. */
  subs: string[]
  /** Permission slug — the SAME one the standalone screen uses. */
  permissionSlug: string
  built: boolean
  /** Needs Cost Control reviewer standing on top of the module permission. */
  reviewerOnly?: boolean
}

/**
 * THE FIFTEEN.
 *
 * Slugs are the ones the cockpit already routes, so no existing link breaks.
 * Three former tabs are absorbed rather than dropped, because each was really
 * a view of another: "Budget by WO/PO" is Budget's second pill, "Payment
 * Reports" is Accounts' first sub-tab, and "Decisions & Specs" is Discussions'
 * decisions log. `ABSORBED` below keeps those old URLs working.
 */
export const WORKSPACE_TABS: WorkspaceTab[] = [
  // ── Money ────────────────────────────────────────────────────────────────
  { slug: '', ribbon: 'Budget', label: 'Budget vs Actual', group: 'money', icon: 'BarChart3',
    subs: ['By category', 'By order', 'By CT'],
    permissionSlug: 'cost-control', built: true },
  // reviewerOnly because these cards carry project-level financials — the ERP
  // budget, approved-so-far and every pending ask. /cost-control/approvals
  // redirects a non-reviewer for exactly that reason, and a tab that showed
  // the same cards on cost-control view alone would be a way round it.
  { slug: 'approvals', ribbon: 'Approvals', label: 'Pending Approvals', group: 'money', icon: 'CircleCheck',
    subs: ['Waiting on me', 'All pending', 'Returned to engineer', 'Transfers'],
    permissionSlug: 'cost-control', built: true, reviewerOnly: true },
  // Top management only — gated on budget-vs-actual-v2, held by admin, head
  // and founder. Hidden rather than greyed for everyone else: a greyed tab
  // still announces that the report exists.
  { slug: 'sc-budgets', ribbon: 'SC Budget', label: 'SC Budget', group: 'money', icon: 'Layers',
    subs: ['Report', 'Category totals', 'Contractors'],
    permissionSlug: 'budget-vs-actual-v2', built: true },
  // One screen, four sections (due · received not billed · held back · by
  // party); no pills, they would only split what reads better together.
  { slug: 'accounts', ribbon: 'Accounts', label: 'Accounts', group: 'money', icon: 'CreditCard',
    subs: [],
    permissionSlug: 'cost-control', built: true, reviewerOnly: true },

  // ── Procurement ──────────────────────────────────────────────────────────
  { slug: 'procurement', ribbon: 'Indents', label: 'Indents', group: 'procurement', icon: 'ClipboardList',
    subs: ['By category', 'Tracker'],
    permissionSlug: 'procurement-tracker', built: true },
  { slug: 'wo-po', ribbon: 'WO / PO', label: 'WO / PO', group: 'procurement', icon: 'GitBranch',
    subs: ['All orders', 'Work orders', 'POs', 'BOQ upload'],
    permissionSlug: 'procurement-tracker', built: true },
  { slug: 'material', ribbon: 'Material', label: 'Material In-Out', group: 'procurement', icon: 'Package',
    subs: ['Issued', 'Received', 'Returned'],
    permissionSlug: 'warehouse', built: true },

  // ── Site ─────────────────────────────────────────────────────────────────
  { slug: 'jmr', ribbon: 'JMR', label: 'JMRs', group: 'site', icon: 'Ruler',
    subs: ['Measure', 'Build abstract', 'Measured vs certified', 'Register'],
    permissionSlug: 'jmr', built: true },
  { slug: 'qc', ribbon: 'QC', label: 'QC', group: 'site', icon: 'ShieldCheck',
    subs: ['Category wise', 'Sub-category wise', 'Level wise', 'QC checklist'],
    permissionSlug: 'cost-control', built: false },
  { slug: 'schedule', ribbon: 'Schedule', label: 'Schedules', group: 'site', icon: 'CalendarDays',
    subs: ['Programme', 'Slippage'],
    permissionSlug: 'cost-control', built: false },

  // ── Documents ────────────────────────────────────────────────────────────
  { slug: 'drawings', ribbon: 'Drawings', label: 'Drawings', group: 'documents', icon: 'FileText',
    subs: ['Design Brief', 'Concept', 'Schematic', 'DD', 'GFCs', 'BOQs', 'Renders', 'As Built'],
    permissionSlug: 'cost-control', built: false },
  { slug: 'reports', ribbon: 'Reports', label: 'Reports', group: 'documents', icon: 'FileBarChart',
    subs: ['Saved', 'Scheduled'],
    permissionSlug: 'contractor-report', built: true },

  // ── People ───────────────────────────────────────────────────────────────
  { slug: 'stakeholders', ribbon: 'Stakeholders', label: 'Stakeholders', group: 'people', icon: 'Users',
    subs: ['SRMD team', 'Consultants', 'Contractors', 'Vendors'],
    permissionSlug: 'cost-control', built: false },
  { slug: 'discussions', ribbon: 'Discussions', label: 'Discussions', group: 'people', icon: 'MessageSquare',
    subs: ['Open', 'Resolved', 'Decisions log'],
    permissionSlug: 'cost-control', built: true },
  { slug: 'consultants', ribbon: 'Consultants', label: 'Consultants & Specialised Cost', group: 'people', icon: 'Briefcase',
    subs: ['Category wise', 'Sub-category wise'],
    permissionSlug: 'cost-control', built: false },
]

/**
 * Old tab URLs that are now a view inside another tab. Kept as redirects so a
 * bookmark, an email link or an approval card from before the change still
 * lands somewhere sensible instead of on a 404.
 */
export const ABSORBED: Record<string, { slug: string; sub: number }> = {
  'wo-view':   { slug: '',            sub: 1 }, // → Budget · Category — WO/PO wise
  'payments':  { slug: 'accounts',    sub: 0 }, // → Accounts (due, held back, by party)
  'decisions': { slug: 'discussions', sub: 2 }, // → Discussions · Decisions log
  'overview':  { slug: '',            sub: 0 }, // Overview folded into Budget
}

/**
 * Setup is deliberately NOT one of the fifteen.
 *
 * It configures the project rather than reporting on it, and §1 fixes the
 * ribbon at fifteen. It stays reachable as a gear beside the sync stamp, and
 * its route is unchanged — hiding it outright would be a silent blocker.
 */
export const SETUP_TAB: WorkspaceTab = {
  slug: 'setup', ribbon: 'Setup', label: 'Project setup', group: 'money', icon: 'Settings2',
  subs: [], permissionSlug: 'cost-control', built: true, reviewerOnly: true,
}

export function findWorkspaceTab(slug: string): WorkspaceTab | undefined {
  if (slug === SETUP_TAB.slug) return SETUP_TAB
  return WORKSPACE_TABS.find(t => t.slug === slug)
}

/** Which tab a cockpit pathname is on. Returns '' for the index. */
export function activeWorkspaceSlug(pathname: string, projectId: string): string {
  const base = `/project/${projectId}`
  if (!pathname.startsWith(base)) return ''
  const rest = pathname.slice(base.length).replace(/^\//, '')
  if (!rest) return ''
  return rest.split('/')[0]
}

export function workspaceHref(projectId: string, tab: WorkspaceTab, sub?: number): string {
  const base = tab.slug ? `/project/${projectId}/${tab.slug}` : `/project/${projectId}`
  return sub && sub > 0 ? `${base}?view=${sub}` : base
}

/** The sub-tab index from `?view=`, clamped to what the tab actually has. */
export function activeSubTab(tab: WorkspaceTab, view: string | undefined): number {
  const n = Number(view)
  if (!Number.isInteger(n) || n < 0 || n >= tab.subs.length) return 0
  return n
}

export type PermissionLike = Record<string, { view?: boolean } | undefined>

/**
 * The tabs this person may open, in ribbon order.
 *
 * Same inputs as the old strip: the permission matrix, the module on/off
 * switches, and Cost Control reviewer standing. A tab whose module is switched
 * off portal-wide disappears; a tab the role cannot view disappears. Unbuilt
 * tabs stay visible and greyed — they are the roadmap, and they carry no data
 * to protect.
 */
export function visibleWorkspaceTabs(
  perms: PermissionLike,
  disabledSlugs: Set<string> | string[],
  isReviewer: boolean,
): WorkspaceTab[] {
  const disabled = disabledSlugs instanceof Set ? disabledSlugs : new Set(disabledSlugs)
  return WORKSPACE_TABS.filter(t => {
    if (t.reviewerOnly && !isReviewer) return false
    // An unbuilt tab shows no data, so it is gated on being in the cockpit at
    // all rather than on the module it will one day use — otherwise the
    // roadmap would be invisible to nearly everyone.
    const slug = t.built ? t.permissionSlug : 'cost-control'
    if (disabled.has(slug)) return false
    return perms[slug]?.view === true
  })
}

/** Ribbon groups with their visible tabs, dropping any group left empty. */
export function ribbonFor(tabs: WorkspaceTab[]): Array<{ id: RibbonGroup; label: string; tabs: WorkspaceTab[] }> {
  return RIBBON_GROUPS
    .map(g => ({ ...g, tabs: tabs.filter(t => t.group === g.id) }))
    .filter(g => g.tabs.length > 0)
}

/** Every workspace slug maps to a tab the cockpit already routes. Guards the
 *  ribbon against naming a slug that would 404. */
export function unroutedSlugs(): string[] {
  const known = new Set(PROJECT_TABS.map((t: ProjectTab) => t.slug))
  return WORKSPACE_TABS.map(t => t.slug).filter(s => !known.has(s))
}
