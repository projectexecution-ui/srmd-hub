// Every administrative screen in CT Hub, in ONE list.
//
// The audit of 3 Sept 2026 counted 43 of them: 9 under /admin and 34 inside
// modules (JMR alone has 14). Each module grew its own settings page because it
// was built in isolation, and finding "where do I set who gets the bills email"
// meant knowing which module's Tools menu to open. This registry is the fix:
// the screens stay where they are, but /admin lists all of them, grouped by
// the job they do, hides the ones inside a switched-off module, and every one
// is gated through the permission matrix (requirePermission) — so the matrix
// is finally the one place that decides who configures what.
//
// Pure data, mirrored by lib/modules.ts for tiles. Add a settings screen here
// when you build one; the test checks every href exists as a route.

export type AdminArea = 'people' | 'approvals' | 'masters' | 'system' | 'notifications' | 'data'

export interface AdminScreen {
  href: string
  label: string
  /** Where it lives — a module slug, or '' for portal-wide. Also the slug the
   *  module on/off switch is checked against. */
  module: string
  area: AdminArea
  /** One line, in the words of what it is FOR. */
  hint: string
  /** Portal-Owner-only screens (the module switch, sidebar groups). */
  ownerOnly?: boolean
}

export const ADMIN_AREAS: Array<{ id: AdminArea; label: string; hint: string }> = [
  { id: 'people',        label: 'People & access',      hint: 'Who is in the hub, and what each role may do' },
  { id: 'approvals',     label: 'Approvals & rules',    hint: 'Who signs off what, per module, and what happens to deletions' },
  { id: 'notifications', label: 'Emails & alerts',      hint: 'Everything the hub sends, and who receives it' },
  { id: 'masters',       label: 'Lists & masters',      hint: 'The catalogues each module keeps — categories, items, rates, stores, contractors' },
  { id: 'data',          label: 'Data & imports',       hint: 'IN4 sync, Excel imports, backups and the audit log' },
  { id: 'system',        label: 'Module settings',      hint: 'Per-module switches, labels and lead times' },
]

export const ADMIN_SCREENS: AdminScreen[] = [
  // ── People & access ──
  { href: '/admin/users',                    label: 'Users & roles',           module: '',                    area: 'people', hint: 'Accounts, roles, access requests, per-module overrides' },
  { href: '/admin/permissions',              label: 'Permissions matrix',      module: '',                    area: 'people', hint: 'The role × module grid: view / edit / admin / delete' },
  { href: '/jmr/admin/admins',               label: 'JMR roles',               module: 'jmr',                 area: 'people', hint: 'Override a person’s role inside JMR only' },
  { href: '/jmr/admin/access',               label: 'JMR project access',      module: 'jmr',                 area: 'people', hint: 'Which sites each engineer may log against' },
  { href: '/inventory/admin/engineers',      label: 'Inventory engineer sites', module: 'inventory',           area: 'people', hint: 'Assign engineers to the sites they raise requests for' },
  { href: '/procurement-tracker/admin',      label: 'Procurement visibility',  module: 'procurement-tracker', area: 'people', hint: 'Which projects each person sees in the tracker, closed projects' },
  { href: '/bills-booking/admin',            label: 'Bills desks',             module: 'bills-booking',       area: 'people', hint: 'Who works each desk, per project' },

  // ── Approvals & rules ──
  { href: '/admin/approvals',                label: 'Approval chains',         module: '',                    area: 'approvals', hint: 'Who may move a document to the next stage, per module' },
  { href: '/admin/delete-requests',          label: 'Delete requests',         module: '',                    area: 'approvals', hint: 'Approve or refuse deletions that need a second pair of eyes' },
  { href: '/admin/recycle-bin',              label: 'Recycle bin',             module: '',                    area: 'approvals', hint: 'Restore anything deleted — nothing is removed automatically' },
  { href: '/blueprint-demo/admin',           label: 'Smart SLAs (sandbox)',    module: 'blueprint-demo',      area: 'approvals', hint: 'Suggested SLA thresholds from observed approval times' },

  // ── Emails & alerts ──
  { href: '/admin/notifications',            label: 'Notification switches',   module: '',                    area: 'notifications', hint: 'Each alert on/off per channel and role; scheduled-job health' },
  { href: '/settings/notifications',         label: 'My notifications',        module: '',                    area: 'notifications', hint: 'Your own channels, phone push, Telegram' },
  { href: '/bills-pipeline/digest-settings', label: 'Bills digest',            module: 'bills-pipeline',      area: 'notifications', hint: 'The daily bills email per Atm Head, and who gets the stuck list' },
  { href: '/daily-site-report/digest',       label: 'Site report digest',      module: 'daily-site-report',   area: 'notifications', hint: 'The shareable daily material-arrivals card' },

  // ── Lists & masters ──
  { href: '/admin/masters/mapping',          label: 'Project name mapping',    module: '',                    area: 'masters', hint: 'What IN4, the budget report, the procurement upload and Zoho call each project' },
  { href: '/cost-control/admin/disciplines', label: 'Work categories',         module: 'cost-control',        area: 'masters', hint: 'Disciplines and sub-skills used by every project' },
  { href: '/cost-control/projects/new',      label: 'New project',             module: 'cost-control',        area: 'masters', hint: 'Create a project with its code, group and approval chain' },
  { href: '/warehouse/settings',             label: 'Warehouse lists',         module: 'warehouse',           area: 'masters', hint: 'Stores, keepers, categories, units, delivery modes, count rules' },
  { href: '/warehouse/items',                label: 'Warehouse items',         module: 'warehouse',           area: 'masters', hint: 'The item catalogue the gate uses' },
  { href: '/inventory/admin/items',          label: 'Inventory items',         module: 'inventory',           area: 'masters', hint: 'The older item catalogue (Inventory V1)' },
  { href: '/inventory/admin/warehouses',     label: 'Inventory warehouses',    module: 'inventory',           area: 'masters', hint: 'The older store list (Inventory V1)' },
  { href: '/inventory/admin/projects',       label: 'Inventory projects',      module: 'inventory',           area: 'masters', hint: 'Project set-up for Inventory V1' },
  { href: '/jmr/admin/items',                label: 'JMR items',               module: 'jmr',                 area: 'masters', hint: 'Machine and manpower types' },
  { href: '/jmr/admin/contractors',          label: 'JMR contractors',         module: 'jmr',                 area: 'masters', hint: 'Contractors who log measured work' },
  { href: '/jmr/admin/rate-cards',           label: 'JMR rate cards',          module: 'jmr',                 area: 'masters', hint: 'Rate per item per contractor, with validity' },
  { href: '/jmr/admin/projects',             label: 'JMR projects',            module: 'jmr',                 area: 'masters', hint: 'Sub-projects used as JMR columns' },
  { href: '/established-rates/admin',        label: 'Rate taxonomy',           module: 'established-rates',   area: 'masters', hint: 'Disciplines, categories and sub-categories for rates; IN4 import' },
  { href: '/vendors',                        label: 'Vendors',                 module: 'vendors',             area: 'masters', hint: 'The vendor master' },
  { href: '/projects',                       label: 'Projects (master)',       module: 'projects',            area: 'masters', hint: 'The project master as the first version of the hub kept it' },

  // ── Data & imports ──
  { href: '/budget/in4',                     label: 'IN4 live sync',           module: 'budget-vs-actual',    area: 'data', hint: 'Budget report rebuilt from IN4 twice a day; shadow comparison; the live switch' },
  { href: '/cost-control/import',            label: 'Cost Control import',     module: 'cost-control',        area: 'data', hint: 'Excel budget import and the BPH → project mapping' },
  { href: '/cost-control/import/bph',        label: 'BPH → project links',     module: 'cost-control',        area: 'data', hint: 'Which Budget-Hub project feeds which Internal Estimate' },
  { href: '/warehouse/settings/sync',        label: 'Warehouse ← IN4 uploads', module: 'warehouse',           area: 'data', hint: 'Bring items and POs across from the Indent → PO upload' },
  { href: '/jmr/admin/import',               label: 'JMR import',              module: 'jmr',                 area: 'data', hint: 'Bulk-load daily entries from Excel' },
  { href: '/inventory/admin/items/import',   label: 'Inventory item import',   module: 'inventory',           area: 'data', hint: 'Load the item master from Excel (Inventory V1)' },
  { href: '/cost-control/audit',             label: 'Audit log',               module: 'cost-control',        area: 'data', hint: 'Who changed what, and when' },
  { href: '/uploads',                        label: 'Upload history',          module: 'uploads',             area: 'data', hint: 'Excel imports of the first version of the hub' },

  // ── Module settings ──
  { href: '/admin/dashboard-modules',        label: 'Modules on / off',        module: '',                    area: 'system', hint: 'Switch a module off for everyone, or rename it', ownerOnly: true },
  { href: '/admin/sidebar-groups',           label: 'Sidebar groups',          module: '',                    area: 'system', hint: 'Nest modules under names you choose', ownerOnly: true },
  { href: '/cost-control/settings',          label: 'Internal Estimate settings', module: 'cost-control',     area: 'system', hint: 'Feature switches, field names, engineer visibility, billing step' },
  { href: '/schedule/settings',              label: 'Schedule settings',       module: 'schedule',            area: 'system', hint: 'Work-back lead times for WO, budget and drawings' },
  { href: '/inventory/admin/settings',       label: 'Inventory settings',      module: 'inventory',           area: 'system', hint: 'Approval before issue, alerts, daily report' },
  { href: '/jmr/admin/settings',             label: 'JMR settings',            module: 'jmr',                 area: 'system', hint: 'GST rate, edit window, the weekly report' },
]

/** Screens in an area, minus those inside a switched-off module and (unless
 *  the viewer is the Portal Owner) the owner-only ones. */
export function screensFor(area: AdminArea, opts: { disabled: ReadonlySet<string>; portalOwner: boolean }): AdminScreen[] {
  return ADMIN_SCREENS.filter(s =>
    s.area === area
    && (!s.module || !opts.disabled.has(s.module))
    && (!s.ownerOnly || opts.portalOwner))
}

/** Same filter, all areas — for search. */
export function allScreens(opts: { disabled: ReadonlySet<string>; portalOwner: boolean }): AdminScreen[] {
  return ADMIN_AREAS.flatMap(a => screensFor(a.id, opts))
}
