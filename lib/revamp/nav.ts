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

/**
 * The lanes that stay top-level. Order is the order they appear.
 *
 * Bills points at the pipeline, not Bills Booking: the pipeline is the weekly
 * SRA/SRET work the ERP team actually does, while Bills Booking holds 2 records.
 */
export const REVAMP_PRIMARY: RevampNavItem[] = [
  { href: '/dashboard',      label: 'Dashboard', icon: LayoutDashboard, slug: null,             built: true },
  { href: '/cost-control',   label: 'Projects',  icon: Building2,       slug: 'cost-control',   built: true },
  { href: '/bills-pipeline', label: 'Bills',     icon: Receipt,         slug: 'bills-pipeline', built: true },
  // Gated on cost-control: every Masters page calls requirePermission('cost-control'),
  // so an ungated lane would show a link that then refuses the person who clicked it.
  { href: '/masters',        label: 'Masters',   icon: Library,         slug: 'cost-control',   built: true },
  { href: '/admin',          label: 'Admin',     icon: Shield,          slug: null,             built: true },
]

/** Screens the cockpit REPLACES — the same information now lives inside a
 *  project. Kept reachable so the trial can be compared against today. */
export const REVAMP_OLD_SCREENS: RevampNavItem[] = [
  // The module slug is 'budget-vs-actual' — /budget is its href, not its slug.
  // Gating on 'budget' meant nobody held it, so this lane never appeared for
  // anyone. Caught by cross-checking every nav slug against lib/modules.ts.
  { href: '/budget',              label: 'Budget (BPH)',        icon: Archive, slug: 'budget-vs-actual',     built: true },
  { href: '/budget-vs-actual',    label: 'Budget vs Actual',    icon: Archive, slug: 'budget-vs-actual',     built: true },
  { href: '/budget-vs-actual-v2', label: 'Budget vs Actual V2', icon: Archive, slug: 'budget-vs-actual-v2',  built: true },
  { href: '/contractor-report',   label: 'Contractor Report',   icon: Archive, slug: 'contractor-report',    built: true },
  { href: '/supplier-report',     label: 'Supplier Report',     icon: Archive, slug: 'supplier-report',      built: true },
  { href: '/procurement-tracker', label: 'Indent → PO',         icon: Archive, slug: 'procurement-tracker',  built: true },
  { href: '/stuck-bills',         label: 'Stuck Bills',         icon: Archive, slug: 'stuck-bills',          built: true },
]

/**
 * Modules deliberately left OUT of the revamp — Aksha, 2026-08-31. Not
 * replaced and not broken: built, working, and not being used enough to earn a
 * lane yet. Listed separately from the replaced screens because "we moved this"
 * and "we parked this" are different messages, and labelling a module people
 * still open as "old" would be wrong.
 *
 * Measured usage at the time of the decision:
 *   Warehouse V2        0 gate movements in or out, 2 live requests
 *   Schedule            2 projects (NGH A 65 items, Admin Block 47)
 *   JMR                 21 entries, all on NGH Infra
 *   Bills Booking       2 records
 *   Inventory (old)     superseded by Warehouse V2
 *   Established Rates   374 rates, module switched off
 *   Comparison          0 records, module switched off
 *   Daily Site Report   1 report, module switched off
 */
export const REVAMP_PARKED: RevampNavItem[] = [
  { href: '/warehouse',         label: 'Warehouse',         icon: Warehouse, slug: 'warehouse',         built: true },
  { href: '/schedule',          label: 'Schedule',          icon: Archive,   slug: 'schedule',          built: true },
  { href: '/jmr',               label: 'JMR',               icon: Archive,   slug: 'jmr',               built: true },
  { href: '/bills-booking',     label: 'Bills Booking',     icon: Archive,   slug: 'bills-booking',     built: true },
  { href: '/inventory',         label: 'Inventory (old)',   icon: Archive,   slug: 'inventory',         built: true },
  { href: '/established-rates', label: 'Established Rates', icon: Archive,   slug: 'established-rates', built: true },
  { href: '/comparison',        label: 'Comparisons',       icon: Archive,   slug: 'comparison',        built: true },
  { href: '/daily-site-report', label: 'Daily Site Report', icon: Archive,   slug: 'daily-site-report', built: true },
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

  // Two branches, not one: "we moved this into the project" and "we parked
  // this" are different messages, and a module someone still opens should not
  // be filed under "old".
  const groups: RevampNavGroup[] = []
  const replaced = REVAMP_OLD_SCREENS.filter(allowed)
  if (replaced.length) groups.push({ id: 'revamp_old', name: 'Now inside a project', items: replaced })
  const parked = REVAMP_PARKED.filter(allowed)
  if (parked.length) groups.push({ id: 'revamp_parked', name: 'Not in the revamp', items: parked })

  return { primary, groups }
}
