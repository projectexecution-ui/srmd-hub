// The revamped left pane.
//
// Today's sidebar is one lane per module — 15+ entries, because every module
// is a place you visit and then filter down to the project you meant. The
// revamp inverts that: PROJECTS is the main lane, and Budget / Approvals /
// Reports / Schedule / Stores live as tabs inside a project's cockpit.
//
// What survives as its own top-level lane is only what is genuinely
// cross-project: the ERP team's Bills desk, the warehouse, the Masters
// everything references, and Admin.
//
// The old screens are NOT deleted — they move into a collapsed "Old screens"
// branch so nothing silently disappears and the two can be compared
// side-by-side during the trial. That was Aksha's call: "B is ok which u can
// collapse in a group calling coming soon something like that."
//
// Pure — no React, no Supabase — so it is unit-testable and importable from
// the client NavBar.

import {
  LayoutDashboard, Building2, Receipt, Warehouse, Library, Shield, Archive,
  type LucideIcon,
} from 'lucide-react'

export interface RevampNavItem {
  href: string
  label: string
  icon: LucideIcon
  /** Permission slug this lane is gated on, or null for always-visible. */
  slug: string | null
  /** False = the lane exists in the plan but the page is not written yet. */
  built: boolean
}

export interface RevampNavGroup {
  id: string
  name: string
  items: RevampNavItem[]
}

/** The lanes that stay top-level. Order is the order they appear. */
export const REVAMP_PRIMARY: RevampNavItem[] = [
  { href: '/dashboard',    label: 'Dashboard', icon: LayoutDashboard, slug: null,           built: true },
  { href: '/cost-control', label: 'Projects',  icon: Building2,       slug: 'cost-control', built: true },
  { href: '/bills-booking', label: 'Bills',    icon: Receipt,         slug: 'bills-booking', built: true },
  { href: '/warehouse',    label: 'Warehouse', icon: Warehouse,       slug: 'warehouse',    built: true },
  { href: '/masters',      label: 'Masters',   icon: Library,         slug: null,           built: false },
  { href: '/admin',        label: 'Admin',     icon: Shield,          slug: null,           built: true },
]

/** Everything the cockpit replaces. Kept reachable, one click deeper, so the
 *  trial can be compared against what people use today. */
export const REVAMP_OLD_SCREENS: RevampNavItem[] = [
  { href: '/budget',              label: 'Budget (BPH)',        icon: Archive, slug: 'budget',               built: true },
  { href: '/budget-vs-actual',    label: 'Budget vs Actual',    icon: Archive, slug: 'budget-vs-actual',     built: true },
  { href: '/budget-vs-actual-v2', label: 'Budget vs Actual V2', icon: Archive, slug: 'budget-vs-actual-v2',  built: true },
  { href: '/contractor-report',   label: 'Contractor Report',   icon: Archive, slug: 'contractor-report',    built: true },
  { href: '/supplier-report',     label: 'Supplier Report',     icon: Archive, slug: 'supplier-report',      built: true },
  { href: '/bills-pipeline',      label: 'Bills Pipeline',      icon: Archive, slug: 'bills-pipeline',       built: true },
  { href: '/stuck-bills',         label: 'Stuck Bills',         icon: Archive, slug: 'stuck-bills',          built: true },
  { href: '/procurement-tracker', label: 'Indent → PO',         icon: Archive, slug: 'procurement-tracker',  built: true },
  { href: '/jmr',                 label: 'JMR',                 icon: Archive, slug: 'jmr',                  built: true },
  { href: '/schedule',            label: 'Schedule',            icon: Archive, slug: 'schedule',             built: true },
  { href: '/inventory',           label: 'Inventory (old)',     icon: Archive, slug: 'inventory',            built: true },
]

export interface PermissionMap {
  [slug: string]: { view?: boolean } | undefined
}

/**
 * Build the revamped pane for one person.
 *
 * A lane with a permission slug shows only if they can view it AND the module
 * is switched on — the same two gates today's sidebar uses, so the revamp can
 * never widen anybody's access by accident. Lanes with `slug: null`
 * (Dashboard, Masters, Admin) are handled by the caller / the page's own gate.
 */
export function buildRevampNav(
  permissions: PermissionMap,
  disabledSlugs: Set<string>,
  opts: { canSeeAdmin: boolean },
): { primary: RevampNavItem[]; groups: RevampNavGroup[] } {
  const allowed = (it: RevampNavItem) => {
    if (it.slug === null) return true
    if (disabledSlugs.has(it.slug)) return false
    return permissions[it.slug]?.view === true
  }

  const primary = REVAMP_PRIMARY
    .filter(it => it.href !== '/admin' || opts.canSeeAdmin)
    .filter(allowed)

  const old = REVAMP_OLD_SCREENS.filter(allowed)
  const groups: RevampNavGroup[] = old.length
    ? [{ id: 'revamp_old', name: 'Old screens', items: old }]
    : []

  return { primary, groups }
}
