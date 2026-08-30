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
  { slug: '',            label: 'Overview',    hint: 'Money, progress and what is waiting on someone', built: true,  permissionSlug: 'cost-control' },
  { slug: 'budget',      label: 'Budget',      hint: 'Internal Estimate, approvals and ERP position',  built: true,  permissionSlug: 'cost-control' },
  { slug: 'approvals',   label: 'Approvals',   hint: 'Everything waiting on someone in this project',  built: true,  permissionSlug: 'cost-control' },
  { slug: 'reports',     label: 'Reports',     hint: 'Contractor, Supplier and Bills for this project', built: false, permissionSlug: 'contractor-report' },
  { slug: 'schedule',    label: 'Schedule',    hint: 'Plan vs actual, WO deadlines and drawings',      built: true,  permissionSlug: 'schedule' },
  { slug: 'stores',      label: 'Stores',      hint: 'Stock, requests and gate movements',             built: true,  permissionSlug: 'warehouse' },
  { slug: 'procurement', label: 'Indent → PO', hint: 'Indents raised, POs pending, deliveries due',    built: false, permissionSlug: 'procurement-tracker' },
  { slug: 'jmr',         label: 'JMR',         hint: 'Daily measured work on this site',               built: true,  permissionSlug: 'jmr' },
  { slug: 'discussions', label: 'Discussions', hint: 'Instructions and questions, with owners',        built: false, permissionSlug: 'cost-control' },
  { slug: 'setup',       label: 'Setup',       hint: 'Categories, approvers, area and grouping',       built: true,  permissionSlug: 'cost-control' },
]

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
