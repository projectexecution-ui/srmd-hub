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
// The old screens are NOT deleted, but since go-live (Aksha, 10 Sep 2026:
// "remove both groups — keep only 5 lanes") they are no longer in the pane at
// all. During the trial they sat in two collapsed branches for side-by-side
// comparison; that comparison is over. They stay reachable by URL (bookmarks,
// e-mail links) and from a fold on the Admin home (oldScreensFor).
//
// Pure — no React, no Supabase — so it is unit-testable and importable from
// the client NavBar.

import {
  LayoutDashboard, Building2, Receipt, Shield, Archive, CreditCard, Warehouse, ReceiptText,
  ClipboardList,
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
  /** Needs `can_admin` on the slug, not just `can_view`. Used where the pages
   *  themselves demand admin — a lane gated more loosely than the page behind
   *  it is a link that refuses the person who clicks it. */
  adminOnly?: boolean
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
  // Money across the whole hub — a trust's total, a party's ledger, a
  // financial year. None of those are answerable inside one project, which
  // is why it is a lane and not a tab. Shown only to the people named in
  // Cost Control settings; see buildRevampNav below.
  { href: '/accounts',       label: 'Accounts',  icon: CreditCard,      slug: 'cost-control',   built: true },
  // Material In & Out — the main-gate register, the store and what it holds.
  // A lane rather than only a project tab because the gate is ONE queue for
  // the whole ashram and one warehouse holds material for eleven sites;
  // neither question can be answered from inside a single project.
  // Shown to ADMIN ONLY for now — Aksha, 13 Sep 2026: "for now keep it
  // visible for me only Admin - so we can check and do any changes required".
  { href: '/stores',         label: 'Stores',    icon: Warehouse,       slug: null,             built: true },
  // OLD INDENT TO PO — the V1 tracker, restored 21 Sep 2026 on Aksha's ask:
  // "it was very helpful for me to check all Projects in one screen ... can u
  // make which is only visible to me only - name it OLD INDENT TO PO".
  // Admin-only, which is how this hub says "only him". The live
  // /procurement-tracker is untouched and stays for everybody who has it.
  { href: '/old-indent-to-po', label: 'OLD INDENT TO PO', icon: ClipboardList, slug: null, built: true },
  // Bills Approval — every contractor and vendor bill across every project,
  // from entry to Approved. It was parked when it held 2 records; it now sits
  // over the live IN4 certificate ledger and is the section Aksha asked for in
  // the pane (13 Sep 2026: "make the Whole Section in Left Pane for Admin
  // only"). Admin-only, matching requireBillsAccess() on every page inside it.
  { href: '/bills-booking',  label: 'Bills Approval', icon: ReceiptText, slug: 'bills-booking',  built: true, adminOnly: true },
  // Masters left the pane on 23 Sep 2026 (Aksha, E1): it lives under
  // Admin › Data › Masters, and /masters itself still answers.
  { href: '/admin',          label: 'Admin',     icon: Shield,          slug: null,             built: true },
]

/** Screens the cockpit REPLACES — the same information now lives inside a
 *  project. Kept reachable so the trial can be compared against today. */
export const REVAMP_OLD_SCREENS: RevampNavItem[] = [
  { href: '/budget-vs-actual-v2', label: 'Budget vs Actual V2', icon: Archive, slug: 'budget-vs-actual-v2',  built: true },
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
 *
 * Bills Approval left this list on 14 Sep 2026: it stopped being a two-record
 * module and became the section over IN4's live certificate ledger, so it is a
 * lane of its own above. The list is empty now and stays as the place to park
 * the next one.
 */
export const REVAMP_PARKED: RevampNavItem[] = []

export interface PermissionMap {
  [slug: string]: { view?: boolean; admin?: boolean } | undefined
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
  /** canSeeAccounts is the named list in Cost Control settings, resolved on
   *  the server — roles cannot draw that line, four people hold `head`. */
  opts: {
    canSeeAdmin: boolean; canSeeAccounts?: boolean; canSeeStores?: boolean
    canSeeOldIndent?: boolean
  },
): { primary: RevampNavItem[]; groups: RevampNavGroup[] } {
  const allowed = (it: RevampNavItem) => {
    if (it.slug === null) return true
    if (disabledSlugs.has(it.slug)) return false
    // `view` on the matrix is not enough for an admin-only lane: four roles
    // carry view on bills-booking today and every page inside it calls
    // requirePermission(..., 'admin'). Gating the lane the same way keeps the
    // pane from offering a door that will not open.
    if (it.adminOnly) return permissions[it.slug]?.admin === true
    return permissions[it.slug]?.view === true
  }

  const primary = REVAMP_PRIMARY
    .filter(it => it.href !== '/admin' || opts.canSeeAdmin)
    // Absent, not greyed: a greyed lane still announces that the report
    // exists, and "not to be seen" means not seen.
    .filter(it => it.href !== '/accounts' || opts.canSeeAccounts === true)
    // Stores is being reviewed, so only the reviewer sees it. When it opens
    // up this becomes a permission slug like every other lane — the flag is
    // the pilot, not the design.
    .filter(it => it.href !== '/stores' || opts.canSeeStores === true)
    // His alone. canSeeOldIndentToPo in lib/old-indent-to-po.ts is the one
    // rule, and the page behind this calls the same function — a lane hidden
    // by one test and a page guarded by another is how the two drift.
    .filter(it => it.href !== '/old-indent-to-po' || opts.canSeeOldIndent === true)
    .filter(allowed)

  // Five lanes and nothing under them. The groups array stays in the shape so
  // the NavBar needs no change; it is always empty now (Aksha, 10 Sep 2026).
  return { primary, groups: [] as RevampNavGroup[] }
}

// The "Old screens" fold that listed REVAMP_OLD_SCREENS on the Admin home went
// on 23 Sep 2026 (Aksha, G2). The addresses still answer; they are just no
// longer offered anywhere.
