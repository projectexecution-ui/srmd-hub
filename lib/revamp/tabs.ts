// The project cockpit's tab list — ONE source of truth, the same way
// lib/modules.ts is the one source for modules. Pure (no Supabase, no React)
// so it can be unit-tested and imported from both server and client.
//
// The revamp's central idea: you open a PROJECT, and Budget / Reports /
// Indent → PO are tabs INSIDE it — not separate modules you visit and then
// filter down to the project you actually meant.
//
// `built` is deliberately part of the data. Aksha's rule for the preview was
// "honest tabs": a page that does not exist yet says so before you click it,
// rather than opening an empty screen. Flip the flag when the tab lands.

export interface ProjectTab {
  /** URL segment under /project/[id]. Empty string = the index (Budget). */
  slug: string
  /** ≤5 words — Aksha's V1-layout rule; long labels wrap and look unfinished. */
  label: string
  /** One line, used as the tab's title attribute. */
  hint: string
  /** False = the tab renders a "not built yet" panel instead of a dead screen. */
  built: boolean
  /** Which existing module's permission gates it, once permissions are wired.
   *  Recorded now so the migration has a map instead of a guess (issue #6). */
  permissionSlug: string
  /** Needs Cost Control REVIEWER standing on top of the permission — the
   *  page itself redirects anyone else. Without this the tab shows to an
   *  engineer, who clicks it and is thrown out of the cockpit with no reason
   *  given. Module permission alone is not always the whole gate. */
  reviewerOnly?: boolean
  /** For a coming-soon tab: the module it will belong to once built. Recorded
   *  so the eventual permission is a map rather than a guess. */
  futureSlug?: string
  /** For a coming-soon tab whose work already happens SOMEWHERE — the screen
   *  to send people to meanwhile, so a greyed tab is never a dead end. */
  todayHref?: string
  /**
   * Set when the page cannot be built from what CT Hub holds — the data does
   * not exist, so this needs a DECISION about where it comes from, not dev
   * time. Distinguished from plain "coming soon" because the two need
   * completely different things from Aksha.
   */
  blockedBy?: string
}

/**
 * THE PAGES OF A PROJECT — in the order of Aksha's mind map, 2026-09-03.
 *
 * The map has 17 pages under Projects → Project → Pages. This list is that
 * structure, faithfully, with three honest states rather than two:
 *
 *   built            it works now
 *   coming soon      buildable; just not written yet
 *   blocked          the DATA does not exist, so it needs a decision about
 *                    where the data comes from, not developer time
 *
 * The distinction matters because those need different things from Aksha. Four
 * pages he drew are blocked, and all four are the deepest level of the map —
 * "Breakup Item Wise with Unit Qty Rate Amt". Verified 2026-09-03: 629 working
 * sheets exist but cc_working_sheet_items, po_lines, indent_lines and payments
 * are ALL empty. Sheets carry summary amounts only, so there is no item to
 * break down and no payment to attribute to one.
 *
 * Four pages here were previously PARKED by me and are now restored, because
 * they are in the map and they are already built: Pending Approvals, JMRs,
 * Material In-Out and Schedules.
 */
export const PROJECT_TABS: ProjectTab[] = [
  // ── Built ────────────────────────────────────────────────────────────────
  // Budget is the INDEX tab — Aksha's call. Opening a project lands on the
  // Internal Estimate, which is what people came for. This is map page 1,
  // "Budget Vs Actual: Cat Sub Cat Wise".
  { slug: '',             label: 'Budget vs Actual', hint: 'Category and sub-category, against the ERP position',   built: true,  permissionSlug: 'cost-control' },
  { slug: 'approvals',    label: 'Pending Approvals', hint: 'Budget requests part-way through their sign-off chain', built: true,  permissionSlug: 'cost-control' },
  { slug: 'discussions',  label: 'Discussions',      hint: 'Every comment on this project, in one place',           built: true,  permissionSlug: 'cost-control' },
  { slug: 'procurement',  label: 'Indents',          hint: 'Indents raised, and what is still to be ordered',       built: true,  permissionSlug: 'procurement-tracker' },
  { slug: 'wo-po',        label: 'WO / POs',         hint: 'The Indent → PO tracker: POs raised, deliveries due',   built: true,  permissionSlug: 'procurement-tracker' },
  { slug: 'jmr',          label: 'JMRs',             hint: 'Measured work logged against this project',             built: true,  permissionSlug: 'jmr' },
  { slug: 'material',     label: 'Material In-Out',  hint: 'Gate entries in and out of the store',                  built: true,  permissionSlug: 'warehouse' },
  { slug: 'reports',      label: 'Reports',          hint: 'Contractor, Supplier and Bills for this project',       built: true,  permissionSlug: 'contractor-report' },

  // TOP MANAGEMENT ONLY — Aksha, 2026-09-03: "not to be seen by Eng level but
  // only managment - not also Mayank bhai should not be able to see - atm heads
  // can", then "No Parimal also cant see".
  //
  // Gated on `budget-vs-actual-v2`, which today only ADMIN and HEAD hold. That
  // is exactly the line he drew, by construction rather than by a list someone
  // has to maintain: the four Atm Heads are in; coordinator (Parimal),
  // backoffice (Mayank), engineer, contractor, viewer and uploader are all out.
  //
  // Two mechanisms deliberately NOT used:
  //   `roles_management` — contains backoffice, so Mayank would have seen it,
  //     and its own file says it is a labelling layer, not a confidentiality gate.
  //   `reviewerOnly` (checkIsCcReviewer) — includes `coordinator`, so Parimal
  //     would have seen it. Right gate for the Internal Estimate, wrong one here.
  //
  // The Trustee (founder) has no budget-vs-actual-v2 row today, so he cannot
  // see it either — flagged to Aksha as one row to grant, not assumed.
  //
  // HIDDEN rather than greyed for everyone else: a greyed tab still announces
  // that the report exists, and "not to be seen" means not seen.
  { slug: 'sc-budgets',   label: 'SC Budgets',       hint: 'Top management report — pick projects, categories and columns', built: true, permissionSlug: 'budget-vs-actual-v2' },
  // Not on the mind map — it is how a project gets configured, and the map
  // covers pages people READ. Kept last so it never competes with them.
  { slug: 'setup',        label: 'Setup',            hint: 'Categories, approvers, area and grouping',              built: true,  permissionSlug: 'cost-control', reviewerOnly: true },

  // ── Coming soon ──────────────────────────────────────────────────────────
  // Buildable. Gated on `cost-control` — the permission to be in the cockpit
  // at all — NOT on the module each will eventually use: a greyed tab shows no
  // data, so there is nothing to protect, and gating on the future module would
  // hide the roadmap from nearly everyone (daily-site-report is off portal-wide,
  // most roles have no `schedule`). `futureSlug` keeps the map.
  { slug: 'wo-view',      label: 'Budget by WO/PO',  hint: 'The same budget seen work-order wise, not category wise', built: false, permissionSlug: 'cost-control' },
  { slug: 'schedule',     label: 'Schedules',        hint: 'Master and detailed, down to tasks — its own screen today', built: false, permissionSlug: 'cost-control', futureSlug: 'schedule', todayHref: '/schedule' },
  { slug: 'stakeholders', label: 'Stake Holders',    hint: 'Everyone attached to this project and their part in it',  built: false, permissionSlug: 'cost-control' },
  { slug: 'drawings',     label: 'Drawings',         hint: 'Not captured anywhere yet — the first stage of the WO chain', built: false, permissionSlug: 'cost-control' },
  { slug: 'decisions',    label: 'Decisions & Specs', hint: 'Decisions taken, by category and sub-category',          built: false, permissionSlug: 'cost-control' },
  { slug: 'qc',           label: 'QC',               hint: 'Daily site quality checks and the trend over time',       built: false, permissionSlug: 'cost-control' },
  // ── Blocked: no data exists ──────────────────────────────────────────────
  { slug: 'payments',     label: 'Payment Reports',  hint: 'What has actually been paid out on this project',         built: false, permissionSlug: 'cost-control',
    blockedBy: 'The payments table is empty — CT Hub has never held payment records. Needs an IN4 or Zoho export.' },
  { slug: 'accounts',     label: 'Accounts',         hint: 'Reconcile with Trust accounts, and party ledgers',        built: false, permissionSlug: 'cost-control',
    blockedBy: 'No trust-account or party-ledger data in CT Hub. Needs a feed from the accounting system.' },
]

/**
 * The deepest level of the mind map — the item breakdown under each Budget
 * vs Actual view. NOT tabs: they are how a sub-category expands.
 *
 * All four are blocked on the same fact, so they are recorded here rather than
 * as four dead tabs: 629 working sheets hold summary amounts only, and
 * cc_working_sheet_items is empty. The HOD asked for exactly this (checklist
 * #8a/#8b) and it needs one of — an IN4 export carrying WO/PO line items,
 * engineers entering items by hand, or accepting sub-category level only.
 */
export const BLOCKED_ITEM_VIEWS = [
  'Budget breakup, item wise with Unit / Qty / Rate / Amt',
  'Already Paid breakup, item wise with Unit / Qty / Rate / Amt',
  'WO/PO breakup, item wise with Unit / Qty / Rate / Amt',
] as const

/** The tabs that exist and work. */
export const BUILT_TABS = PROJECT_TABS.filter(t => t.built)

/** The mind-map lanes still to come — rendered greyed, under "Coming soon". */
export const COMING_SOON_TABS = PROJECT_TABS.filter(t => !t.built)

/**
 * PARKED, not deleted — Aksha, 2026-08-31: "right now remove them but keep in
 * ur memory whenever i want we will take that feature".
 *
 * Each is finished and tested; only its row above was removed, so restoring one
 * is a single line. The components and loaders stay where they are:
 *
 *   Approvals  ApprovalsTab in ../app/(app)/project/[id]/tabs.tsx
 *              loadProjectApprovals in ./tab-data.ts
 *              Showed budget requests part-way through the sign-off chain and
 *              which desk each sits on. Removed because the Dashboard's
 *              "Needs you now" already answers that across every project.
 *
 *   Stores     StoresTab, loadProjectStores
 *              Removed because the warehouse is not in use yet — wh_gate_in and
 *              wh_gate_out are both 0, and only 2 real requests exist.
 *
 *   JMR        JmrTab, loadProjectJmr
 *              Removed because JMR has 21 entries in total, all on NGH Infra.
 *
 *   Schedule   rendered the existing /schedule/[id] page whole, so there is no
 *              cockpit-specific code to keep — restoring it is only the tab row
 *              plus its branch in [...rest]/page.tsx. Removed because only 2
 *              projects have a schedule at all (NGH A 65 items, Admin Block 47).
 *
 *   Overview   OverviewTab in ../app/(app)/project/[id]/OverviewTab.tsx
 *              Removed because Budget is the landing tab and its table already
 *              carries Internal Estimate, Budget, WO, Paid and % Used — the
 *              Overview repeated them one level less precisely.
 */
export const PARKED_TABS = ['approvals', 'stores', 'jmr', 'schedule', 'overview'] as const

/**
 * Where clicking a project name goes.
 *
 * On the TRIAL deployment it opens the new cockpit, because experiencing
 * project-first navigation is the whole point of the trial. On the live site it
 * stays on today's Internal Estimate page, so this file is safe to exist there
 * and nobody's habits change until the revamp is actually adopted.
 */
export function projectHref(projectId: string): string {
  const trial =
    process.env.NEXT_PUBLIC_DEMO_MODE === '1' || process.env.VERCEL_ENV === 'preview'
  return trial ? `/project/${projectId}` : `/cost-control/projects/${projectId}`
}

/** Absolute path for a tab. The index tab has no trailing segment so the
 *  cockpit's own URL stays clean (`/project/<id>`, not `/project/<id>/`). */
export function tabHref(projectId: string, tab: ProjectTab): string {
  return tab.slug ? `/project/${projectId}/${tab.slug}` : `/project/${projectId}`
}

/** Which tab a pathname is on. Returns the index tab for the bare cockpit URL
 *  and for anything unrecognised, so the bar always has exactly one active
 *  item rather than none. Longest match wins, so `/budget` never matches ''. */
export function activeTabSlug(pathname: string, projectId: string): string {
  const base = `/project/${projectId}`
  if (!pathname.startsWith(base)) return ''
  const rest = pathname.slice(base.length).replace(/^\//, '')
  if (!rest) return ''
  const seg = rest.split('/')[0]
  return PROJECT_TABS.some(t => t.slug === seg) ? seg : ''
}

export function findTab(slug: string): ProjectTab | undefined {
  return PROJECT_TABS.find(t => t.slug === slug)
}

/**
 * The tabs THIS person may open.
 *
 * Every tab is gated on its own module's permission — the same slug the module
 * uses as a standalone screen — plus the Portal Owner's on/off switch.
 *
 * This exists because the cockpit was, briefly, a way around the permission
 * matrix: the layout gated everything on `cost-control`, which all eight roles
 * hold, so the Reports tab handed contractor and supplier billing to the two
 * contractor accounts and the two engineers, none of whom have
 * `contractor-report`. Nesting a screen inside a project must never grant
 * access the same screen refuses at the top level.
 */
export function visibleTabs(
  perms: Record<string, { view?: boolean } | undefined>,
  disabled: Set<string> = new Set(),
  isReviewer = true,
): ProjectTab[] {
  return PROJECT_TABS.filter(t => canOpenTab(t, perms, disabled, isReviewer))
}

/** Whether this person may open one specific tab. */
export function canOpenTab(
  tab: ProjectTab,
  perms: Record<string, { view?: boolean } | undefined>,
  disabled: Set<string> = new Set(),
  isReviewer = true,
): boolean {
  if (tab.reviewerOnly && !isReviewer) return false
  return perms[tab.permissionSlug]?.view === true && !disabled.has(tab.permissionSlug)
}

/** How much of the cockpit is real today. */
export function builtCount(): { built: number; total: number } {
  return { built: PROJECT_TABS.filter(t => t.built).length, total: PROJECT_TABS.length }
}
