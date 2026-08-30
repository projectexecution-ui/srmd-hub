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
  { href: '/jmr/admin/admins',           label: 'JMR roles',            module: 'jmr',         area: 'people', hint: 'Override a person’s role inside JMR only' },
  { href: '/jmr/admin/access',           label: 'JMR project access',   module: 'jmr',         area: 'people', hint: 'Which sites each engineer may log against' },
  { href: '/inventory/admin/engineers',  label: 'Engineer sites',       module: 'inventory',   area: 'people', hint: 'Assign engineers to their sites' },
  { href: '/procurement-tracker/admin',  label: 'Procurement visibility', module: 'procurement-tracker', area: 'people', hint: 'Which projects each person sees in the tracker' },

  // ── Approvals & rules ──
  { href: '/admin/approvals',            label: 'Approval chains',      module: '',            area: 'approvals', hint: 'Who may move a document to the next stage, per module' },
  { href: '/admin/delete-requests',      label: 'Delete requests',      module: '',            area: 'approvals', hint: 'Approve or refuse deletions that need a second pair of eyes' },
  { href: '/admin/recycle-bin',          label: 'Recycle bin',          module: '',            area: 'approvals', hint: 'Restore anything deleted — nothing is removed automatically' },
  { href: '/bills-booking/admin',        label: 'Bills desks',          module: 'bills-booking', area: 'approvals', hint: 'Who works each desk, per project' },
  { href: '/cost-control/projects/new',  label: 'New project',          module: 'cost-control', area: 'approvals', hint: 'Create a project and its approval chain' },

  // ── Lists & catalogues ──
  { href: '/masters',                    label: 'Masters',              module: '',            area: 'lists', hint: 'The lists everything points at — and where they duplicate' },
  { href: '/cost-control/admin/disciplines', label: 'Work categories',  module: 'cost-control', area: 'lists', hint: 'Disciplines and sub-skills used by every project' },
  { href: '/warehouse/settings',         label: 'Warehouse lists',      module: 'warehouse',   area: 'lists', hint: 'Stores, keepers, categories, units, delivery modes' },
  { href: '/inventory/admin/items',      label: 'Inventory items',      module: 'inventory',   area: 'lists', hint: 'The older item catalogue' },
  { href: '/inventory/admin/warehouses', label: 'Inventory warehouses', module: 'inventory',   area: 'lists', hint: 'The older store list' },
  { href: '/jmr/admin/items',            label: 'JMR items',            module: 'jmr',         area: 'lists', hint: 'Machine and manpower types' },
  { href: '/jmr/admin/contractors',      label: 'JMR contractors',      module: 'jmr',         area: 'lists', hint: 'Contractors who log measured work' },
  { href: '/jmr/admin/rate-cards',       label: 'JMR rate cards',       module: 'jmr',         area: 'lists', hint: 'Rate per item per contractor, with validity' },
  { href: '/jmr/admin/projects',         label: 'JMR projects',         module: 'jmr',         area: 'lists', hint: 'Sub-projects used as JMR columns' },
  { href: '/established-rates/admin',    label: 'Rate taxonomy',        module: 'established-rates', area: 'lists', hint: 'Disciplines, categories and sub-categories for rates' },
  { href: '/vendors',                    label: 'Vendors',              module: 'vendors',     area: 'lists', hint: 'The contact list as it exists today' },

  // ── System ──
  { href: '/admin/notifications',        label: 'Notifications',        module: '',            area: 'system', hint: 'Which alerts go out, on which channel, and job health' },
  { href: '/admin/dashboard-modules',    label: 'Modules on/off',       module: '',            area: 'system', hint: 'Switch a module off for everyone, or rename it', adminOnly: true },
  { href: '/admin/sidebar-groups',       label: 'Sidebar groups',       module: '',            area: 'system', hint: 'Nest modules under names you choose', adminOnly: true },
  { href: '/cost-control/settings',      label: 'Cost Control settings', module: 'cost-control', area: 'system', hint: 'Feature switches, field names, engineer visibility' },
  { href: '/schedule/settings',          label: 'Schedule settings',    module: 'schedule',    area: 'system', hint: 'Work-back lead times for WO, budget and drawings' },
  { href: '/inventory/admin/settings',   label: 'Inventory settings',   module: 'inventory',   area: 'system', hint: 'Approval before issue, alerts, daily report' },
  { href: '/jmr/admin/settings',         label: 'JMR settings',         module: 'jmr',         area: 'system', hint: 'GST rate and the weekly report' },
  { href: '/bills-pipeline/digest-settings', label: 'Bills digest',     module: 'bills-pipeline', area: 'system', hint: 'The daily bills email, and who gets the stuck list' },
  { href: '/warehouse/settings/sync',    label: 'Warehouse sync',       module: 'warehouse',   area: 'system', hint: 'Bring items and POs across from the IN4 uploads' },
  { href: '/cost-control/import',        label: 'Cost Control import',  module: 'cost-control', area: 'system', hint: 'Excel and BPH budget imports' },
  { href: '/jmr/admin/import',           label: 'JMR import',           module: 'jmr',         area: 'system', hint: 'Bulk-load daily entries from Excel' },
  { href: '/cost-control/audit',         label: 'Audit log',            module: 'cost-control', area: 'system', hint: 'Who changed what, and when' },
]

export function screensByArea(area: AdminArea): AdminScreen[] {
  return ADMIN_SCREENS.filter(s => s.area === area)
}

/** How many screens each area holds — shown on the cards so the size of each
 *  area is visible before you open it. */
export function areaCounts(): Record<AdminArea, number> {
  return ADMIN_AREAS.reduce((acc, a) => {
    acc[a.id] = screensByArea(a.id).length
    return acc
  }, {} as Record<AdminArea, number>)
}
