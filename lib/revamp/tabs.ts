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
}

export const PROJECT_TABS: ProjectTab[] = [
  // Budget is the INDEX tab — Aksha's call. Opening a project lands on the
  // Internal Estimate, which is what people came for.
  { slug: '',            label: 'Budget',      hint: 'Internal Estimate, approvals and ERP position',  built: true,  permissionSlug: 'cost-control' },
  { slug: 'reports',     label: 'Reports',     hint: 'Contractor, Supplier and Bills for this project', built: true,  permissionSlug: 'contractor-report' },
  { slug: 'procurement', label: 'Indent → PO', hint: 'Indents raised, POs pending, deliveries due',    built: true,  permissionSlug: 'procurement-tracker' },
  { slug: 'discussions', label: 'Discussions', hint: 'Every comment on this project, in one place',      built: true,  permissionSlug: 'cost-control' },
  { slug: 'setup',       label: 'Setup',       hint: 'Categories, approvers, area and grouping',       built: true,  permissionSlug: 'cost-control', reviewerOnly: true },

  // ── COMING SOON ─────────────────────────────────────────────────────────
  // The lanes from Aksha's mind map (docs/TEAM_PROBLEMS.md) that the cockpit
  // does not hold yet: "a single per-project cockpit where everything shows as
  // lanes — schedule, the Dwg → Budget → WO pipeline, daily site entries,
  // procurement, bills." Procurement and Bills are done; these four are not.
  //
  // Shown greyed rather than hidden, so the plan is visible instead of the
  // cockpit looking finished when it is not — the "honest tabs" rule. Each
  // one's hint says where that work happens TODAY, so a greyed tab still
  // points somewhere useful rather than being a dead end.
  //
  // They are gated on `cost-control` — the permission to be in the cockpit at
  // all — NOT on the module they will eventually use. A greyed tab shows no
  // data, so there is nothing to protect, and gating on the future module would
  // hide the roadmap from nearly everyone: daily-site-report is switched off
  // portal-wide, and most roles have no `schedule`. The intended module is kept
  // in `futureSlug` so the map is not lost.
  { slug: 'drawings',  label: 'Drawings',          hint: 'Not captured anywhere yet — the first stage of the WO chain',    built: false, permissionSlug: 'cost-control' },
  { slug: 'pipeline',  label: 'Dwg → Budget → WO', hint: 'Where this project is stuck, and who owns the next step',        built: false, permissionSlug: 'cost-control' },
  { slug: 'site',      label: 'Site entries',      hint: 'Daily material deliveries — on its own screen today',            built: false, permissionSlug: 'cost-control', futureSlug: 'daily-site-report', todayHref: '/daily-site-report' },
  { slug: 'schedule',  label: 'Schedule',          hint: 'Planned vs actual, with Work Orders — on its own screen today',  built: false, permissionSlug: 'cost-control', futureSlug: 'schedule', todayHref: '/schedule' },
]

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
