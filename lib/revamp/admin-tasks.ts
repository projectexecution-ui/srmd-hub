// What an admin is actually TRYING TO DO, and every screen that job touches.
//
// THE PROBLEM THIS SOLVES. The revamped Admin grouped 33 screens into four
// areas and called it done. It wasn't: the areas describe where the CODE lives,
// not what a person came to do. Setting up one new project means visiting seven
// screens spread across four different areas, and nothing tells you that — you
// find out by discovering, a week later, that the project has no approver.
//
// So this is the missing layer: the job first, the screens as its steps, in the
// order they must happen. The A–Z list stays underneath for when you already
// know the screen you want.
//
// RULES
//  1. Every step's href MUST exist in ADMIN_SCREENS. Tested — a task cannot
//     point at a screen that isn't real.
//  2. `why` says what that step achieves, in the words of someone doing the job.
//  3. Steps are ORDERED. Where order does not matter, say so with `anyOrder`.
//  4. Every screen must appear in at least one task, or it is unreachable by
//     job and the sprawl is back. Tested.

import { ADMIN_SCREENS } from './admin-map'

export interface TaskStep {
  /** Must match an ADMIN_SCREENS href. */
  href: string
  /** What this step achieves. Not what the screen is called. */
  why: string
  /** Skip-able — the job still works without it. */
  optional?: boolean
}

export interface AdminTask {
  id: string
  /** Written as the job, starting with a verb. */
  label: string
  hint: string
  /** True when the steps can be done in any order. */
  anyOrder?: boolean
  steps: TaskStep[]
}

export const ADMIN_TASKS: AdminTask[] = [
  {
    id: 'new-project',
    label: 'Start a new project',
    hint: 'Seven screens, and missing one is how a project ends up with no approver',
    steps: [
      { href: '/cost-control/projects/new', why: 'Create it, with its code and its parent group' },
      { href: '/cost-control/admin/disciplines', why: 'Add any work category it needs that does not exist yet', optional: true },
      { href: '/procurement-tracker/admin', why: 'Decide who sees its indents and POs' },
      { href: '/bills-booking/admin', why: 'Say who works each bill desk on it', optional: true },
      { href: '/jmr/admin/access', why: 'Let the site engineers log measured work against it', optional: true },
      { href: '/warehouse/settings', why: 'Point it at a store, if material will move through one', optional: true },
    ],
  },
  {
    id: 'add-person',
    label: 'Add someone to the hub',
    hint: 'The account is the easy part — the per-module access is what gets forgotten',
    steps: [
      { href: '/admin/users', why: 'Approve their access and give them one role' },
      { href: '/admin/permissions', why: 'Check that role can reach what they need' },
      { href: '/procurement-tracker/admin', why: 'Choose which projects they see in the tracker', optional: true },
      { href: '/jmr/admin/admins', why: 'Give them a different role inside JMR only, if needed', optional: true },
      { href: '/inventory/admin/engineers', why: 'Assign them to their sites', optional: true },
    ],
  },
  {
    id: 'approvals',
    label: 'Change who signs off what',
    hint: 'Approval order lives in three places depending on the module',
    anyOrder: true,
    steps: [
      { href: '/admin/approvals', why: 'The chain itself — who may move a document to the next stage' },
      { href: '/bills-booking/admin', why: 'Bill desks, which have their own per-project owners' },
      { href: '/admin/delete-requests', why: 'Deletions that need a second pair of eyes' },
    ],
  },
  {
    id: 'whats-sent',
    label: 'Control what gets emailed out',
    hint: 'Start at the one list — it shows what is going nowhere',
    steps: [
      { href: '/admin/email', why: 'See every message, who receives it, and what reaches nobody' },
      { href: '/admin/notifications', why: 'Turn an alert on or off, per channel' },
      { href: '/bills-pipeline/digest-settings', why: 'Set who gets the bills digest and the stuck list', optional: true },
      { href: '/jmr/admin/settings', why: 'Set who gets the JMR weekly report', optional: true },
      { href: '/inventory/admin/settings', why: 'Set the inventory alerts and daily report', optional: true },
    ],
  },
  {
    id: 'module-onoff',
    label: 'Turn a module on or off',
    hint: 'Switching it off is not enough on its own — the nav and permissions follow separately',
    steps: [
      { href: '/admin/dashboard-modules', why: 'Switch it off for everyone, or rename it' },
      { href: '/admin/sidebar-groups', why: 'Tidy where it sits in the sidebar', optional: true },
      { href: '/admin/permissions', why: 'Check no role is left pointing at something switched off' },
    ],
  },
  {
    id: 'lists',
    label: 'Tidy up the lists',
    hint: 'The same thing is kept in more than one place — start where the duplicates are named',
    steps: [
      { href: '/masters', why: 'See every list and where they duplicate each other' },
      { href: '/cost-control/admin/disciplines', why: 'Work categories and sub-skills' },
      { href: '/warehouse/settings', why: 'Stores, keepers, categories, units' },
      { href: '/jmr/admin/items', why: 'Machine and manpower types', optional: true },
      { href: '/jmr/admin/contractors', why: 'Contractors who log measured work', optional: true },
      { href: '/jmr/admin/rate-cards', why: 'Rate per item per contractor', optional: true },
      { href: '/jmr/admin/projects', why: 'Sub-projects used as JMR columns', optional: true },
      { href: '/inventory/admin/items', why: 'The older item catalogue — check before adding here', optional: true },
      { href: '/inventory/admin/warehouses', why: 'The older store list', optional: true },
      { href: '/established-rates/admin', why: 'Rate taxonomy', optional: true },
      { href: '/vendors', why: 'The contact list as it stands today', optional: true },
    ],
  },
  {
    id: 'recover',
    label: 'Get something back that was deleted',
    hint: 'Nothing is removed automatically — it is all still there',
    anyOrder: true,
    steps: [
      { href: '/admin/recycle-bin', why: 'Restore it yourself' },
      { href: '/admin/delete-requests', why: 'Or approve the deletion someone asked for' },
      { href: '/cost-control/audit', why: 'Find out who changed it, and when', optional: true },
    ],
  },
  {
    id: 'import',
    label: 'Load data in from IN4 or Excel',
    hint: 'Each module takes its own upload — there is no single importer',
    anyOrder: true,
    steps: [
      { href: '/cost-control/import', why: 'Excel and BPH budget imports' },
      { href: '/warehouse/settings/sync', why: 'Bring items and POs across from the IN4 uploads' },
      { href: '/jmr/admin/import', why: 'Bulk-load daily JMR entries', optional: true },
    ],
  },
  {
    id: 'project-settings',
    label: 'Change how a module behaves',
    hint: 'Feature switches, field names, lead times',
    anyOrder: true,
    steps: [
      { href: '/cost-control/settings', why: 'Feature switches, field names, what engineers can see' },
      { href: '/schedule/settings', why: 'Work-back lead times for WO, budget and drawings' },
      { href: '/inventory/admin/settings', why: 'Approval before issue, alerts, daily report' },
      { href: '/jmr/admin/settings', why: 'GST rate and the weekly report' },
    ],
  },
]

/** Steps whose screen is inside a switched-off module are not offered. */
export function taskSteps(task: AdminTask, disabled: Set<string> = new Set()): TaskStep[] {
  const byHref = new Map(ADMIN_SCREENS.map(s => [s.href, s]))
  return task.steps.filter(step => {
    const screen = byHref.get(step.href)
    if (!screen) return false
    return !screen.visibilitySlug || !disabled.has(screen.visibilitySlug)
  })
}

/** Tasks that still have something to do once switched-off modules are removed. */
export function visibleTasks(disabled: Set<string> = new Set()): AdminTask[] {
  return ADMIN_TASKS.filter(t => taskSteps(t, disabled).length > 0)
}

/** Every screen a task can reach. Used to prove nothing is orphaned. */
export function screensCoveredByTasks(): Set<string> {
  return new Set(ADMIN_TASKS.flatMap(t => t.steps.map(s => s.href)))
}

/** Which jobs touch a given screen — shown on the A–Z list so a screen found
 *  by search still says what it is FOR. */
export function tasksTouching(href: string): AdminTask[] {
  return ADMIN_TASKS.filter(t => t.steps.some(s => s.href === href))
}
