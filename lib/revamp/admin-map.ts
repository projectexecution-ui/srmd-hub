// Every administrative screen in CT Hub, grouped.
//
// The audit found 43 of them — 9 under /admin and 34 scattered inside modules
// (JMR alone has 14, more than the whole portal admin). The revamp does not
// delete any: an admin screen that disappears is a job somebody can no longer
// do. It groups them into FOUR areas so the sprawl becomes navigable, and
// names the module each belongs to so it is obvious why it lives where it does.
//
// Pure data — unit-testable, and the one place to add a screen when one is
// built.

export type AdminArea = 'people' | 'approvals' | 'lists' | 'system'

export interface AdminScreen {
  href: string
  label: string
  /** Which module it belongs to; '' for portal-wide. */
  module: string
  area: AdminArea
  /** Shown under the label — say what it is FOR, not what it contains. */
  hint: string
  /** True when only a Portal Owner / admin can open it. */
  adminOnly?: boolean
  /** Module slug to check against module_visibility. A screen inside a
   *  switched-off module is a dead link — established-rates, comparison,
   *  daily-site-report and vendors are all OFF today, and were listed anyway. */
  visibilitySlug?: string
}

export const ADMIN_AREAS: Array<{ id: AdminArea; label: string; hint: string }> = [
  { id: 'people',    label: 'People & access',  hint: 'Who is in the hub, and what each role may do' },
  { id: 'approvals', label: 'Approvals & rules', hint: 'Who signs off what, and what happens to deletions' },
  { id: 'lists',     label: 'Lists & catalogues', hint: 'The masters each module keeps — items, rates, contractors, stores' },
  { id: 'system',    label: 'System',           hint: 'Notifications, scheduled jobs, module switches and imports' },
]

export const ADMIN_SCREENS: AdminScreen[] = [
  // ── People & access ──
  { href: '/admin/users',                label: 'Users & roles',        module: '',            area: 'people', hint: 'Accounts, roles, access requests, per-module overrides' },
  { href: '/admin/permissions',          label: 'Permissions',          module: '',            area: 'people', hint: 'The role × module grid, and the delete rules' },
  { href: '/procurement-tracker/admin',  label: 'Procurement visibility', module: 'procurement-tracker', area: 'people', hint: 'Which projects each person sees in the tracker', visibilitySlug: 'procurement-tracker' },

  // ── Approvals & rules ──
  { href: '/admin/approvals',            label: 'Approval chains',      module: '',            area: 'approvals', hint: 'Who may move a document to the next stage, per module' },
  { href: '/admin/delete-requests',      label: 'Delete requests',      module: '',            area: 'approvals', hint: 'Approve or refuse deletions that need a second pair of eyes' },
  { href: '/admin/recycle-bin',          label: 'Recycle bin',          module: '',            area: 'approvals', hint: 'Restore anything deleted — nothing is removed automatically' },
  { href: '/bills-booking/admin',        label: 'Bills desks',          module: 'bills-booking', area: 'approvals', hint: 'Who works each desk, per project', visibilitySlug: 'bills-booking' },
  { href: '/cost-control/projects/new',  label: 'New project',          module: 'cost-control', area: 'approvals', hint: 'Create a project and its approval chain' },

  // ── Lists & catalogues ──
  { href: '/masters',                    label: 'Masters',              module: '',            area: 'lists', hint: 'The lists everything points at — and where they duplicate' },
  { href: '/cost-control/admin/disciplines', label: 'Work categories',  module: 'cost-control', area: 'lists', hint: 'Disciplines and sub-skills used by every project' },

  // ── System ──
  { href: '/admin/reports',              label: 'Reports & digests',    module: '',            area: 'system', hint: 'Every scheduled report in one place — channels, who gets it, last sent, send now — and a person-by-person mute matrix', adminOnly: true },
  { href: '/admin/email',                label: 'Email & notifications', module: '',           area: 'system', hint: 'Everything the hub sends and who receives it — all modules, one list' },
  { href: '/admin/notifications',        label: 'Notification switches', module: '',           area: 'system', hint: 'Turn each alert on or off per channel, and check job health' },
  { href: '/admin/dashboard-modules',    label: 'Modules on/off',       module: '',            area: 'system', hint: 'Switch a module off for everyone, or rename it', adminOnly: true },
  { href: '/admin/sidebar-groups',       label: 'Sidebar groups',       module: '',            area: 'system', hint: 'Nest modules under names you choose', adminOnly: true },
  { href: '/cost-control/settings',      label: 'Cost Control settings', module: 'cost-control', area: 'system', hint: 'Feature switches, field names, engineer visibility' },
  { href: '/bills-pipeline/digest-settings', label: 'Bills digest',     module: 'bills-pipeline', area: 'system', hint: 'The daily bills email, and who gets the stuck list', visibilitySlug: 'bills-pipeline' },
  { href: '/admin/manual-upload',        label: 'Manual upload (IN4 fallback)', module: '',     area: 'system', hint: 'If the live IN4 read fails: switch on, upload the sheets by hand, switch off when IN4 is back', adminOnly: true },
  { href: '/cost-control/import',        label: 'Cost Control import',  module: 'cost-control', area: 'system', hint: 'Excel and BPH budget imports' },
  { href: '/cost-control/audit',         label: 'Audit log',            module: 'cost-control', area: 'approvals', hint: 'Who changed what, and when' },
]

export function screensByArea(area: AdminArea, disabled: Set<string> = new Set()): AdminScreen[] {
  return ADMIN_SCREENS
    .filter(s => s.area === area)
    // Never offer a screen inside a switched-off module: clicking it only
    // produces a permission refusal, which reads as a bug.
    .filter(s => !s.visibilitySlug || !disabled.has(s.visibilitySlug))
}

/** How many screens each area holds — shown on the cards so the size of each
 *  area is visible before you open it. */
export function areaCounts(): Record<AdminArea, number> {
  return ADMIN_AREAS.reduce((acc, a) => {
    acc[a.id] = screensByArea(a.id).length
    return acc
  }, {} as Record<AdminArea, number>)
}
