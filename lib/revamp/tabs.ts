// The project cockpit's tab list — ONE source of truth, the same way
// lib/modules.ts is the one source for modules. Pure (no Supabase, no React)
// so it can be unit-tested and imported from both server and client.
//
// The revamp's central idea: you open a PROJECT, and Budget / Approvals /
// Reports / Schedule / Stores are tabs INSIDE it — not separate modules you
// visit and then filter down to the project you actually meant.
//
// `built` is deliberately part of the data. Aksha's rule for the preview was
// "honest tabs": a page that does not exist yet says so before you click it,
// rather than opening an empty screen. Flip the flag when the tab lands.

export interface ProjectTab {
  /** URL segment under /project/[id]. Empty string = the index (Overview). */
  slug: string
  /** ≤5 words — Aksha's V1-layout rule; long labels wrap and look unfinished. */
  label: string
  /** One line, shown on the Overview grid and as the tab's title attribute. */
  hint: string
  /** False = the tab renders a "not built yet" panel instead of a dead screen. */
  built: boolean
  /** Which existing module's permission gates it, once permissions are wired.
   *  Recorded now so the migration has a map instead of a guess (issue #6). */
  permissionSlug: string
}

export const PROJECT_TABS: ProjectTab[] = [
  // Budget is the INDEX tab — Aksha's call. Opening a project should land on
  // the Internal Estimate, which is what people actually came for; Overview is
  // the summary you step back to, not the thing you open.
  { slug: '',            label: 'Budget',      hint: 'Internal Estimate, approvals and ERP position',  built: true,  permissionSlug: 'cost-control' },
  { slug: 'overview',    label: 'Overview',    hint: 'Money, progress and what is waiting on someone', built: true,  permissionSlug: 'cost-control' },
  { slug: 'reports',     label: 'Reports',     hint: 'Contractor, Supplier and Bills for this project', built: true,  permissionSlug: 'contractor-report' },
  { slug: 'procurement', label: 'Indent → PO', hint: 'Indents raised, POs pending, deliveries due',    built: true,  permissionSlug: 'procurement-tracker' },
  { slug: 'discussions', label: 'Discussions', hint: 'Every comment on this project, in one place',      built: true,  permissionSlug: 'cost-control' },
  { slug: 'setup',       label: 'Setup',       hint: 'Categories, approvers, area and grouping',       built: true,  permissionSlug: 'cost-control' },
]

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
 */
export const PARKED_TABS = ['approvals', 'stores', 'jmr', 'schedule'] as const

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

/** How much of the cockpit is real today — shown on the Overview so nobody has
 *  to click every tab to find out what is finished. */
export function builtCount(): { built: number; total: number } {
  return { built: PROJECT_TABS.filter(t => t.built).length, total: PROJECT_TABS.length }
}
