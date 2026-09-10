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
  { href: '/procurement-tracker/admin',      label: 'Procurement visibility',  module: 'procurement-tracker', area: 'people', hint: 'Which projects each person sees in the tracker, closed projects' },
  { href: '/bills-booking/admin',            label: 'Bills desks',             module: 'bills-booking',       area: 'people', hint: 'Who works each desk, per project' },

  // ── Approvals & rules ──
  { href: '/admin/approvals',                label: 'Approval chains',         module: '',                    area: 'approvals', hint: 'Who may move a document to the next stage, per module' },
  { href: '/admin/delete-requests',          label: 'Delete requests',         module: '',                    area: 'approvals', hint: 'Approve or refuse deletions that need a second pair of eyes' },
  { href: '/admin/recycle-bin',              label: 'Recycle bin',             module: '',                    area: 'approvals', hint: 'Restore anything deleted — nothing is removed automatically' },

  // ── Emails & alerts ──
  { href: '/admin/notifications',            label: 'Notification switches',   module: '',                    area: 'notifications', hint: 'Each alert on/off per channel and role; scheduled-job health' },
  { href: '/admin/notifications/recipients', label: 'Who receives what',       module: '',                    area: 'notifications', hint: 'Every email and alert the hub sends, with its recipients — edit the lists from one place' },
  { href: '/settings/notifications',         label: 'My notifications',        module: '',                    area: 'notifications', hint: 'Your own channels, phone push, Telegram' },
  { href: '/bills-pipeline/digest-settings', label: 'Bills digest',            module: 'bills-pipeline',      area: 'notifications', hint: 'The daily bills email per Atm Head, and who gets the stuck list' },

  // ── Lists & masters ──
  { href: '/masters',                        label: 'Masters',                 module: '',                    area: 'masters', hint: 'Contacts, items, stores, trusts, projects and work categories — IN4’s register against the hub’s lists' },
  { href: '/masters/contacts',               label: 'Contacts',                module: '',                    area: 'masters', hint: 'Contractors and suppliers from IN4, with PAN and GSTIN; hub entries matched onto them' },
  { href: '/masters/items',                  label: 'Items',                   module: '',                    area: 'masters', hint: 'IN4’s material catalogue as a tree; which items the Warehouse already holds' },
  { href: '/masters/stores',                 label: 'Stores',                  module: '',                    area: 'masters', hint: 'IN4’s stores against the Warehouse’s sites' },
  { href: '/masters/trusts',                 label: 'Trusts',                  module: '',                    area: 'masters', hint: 'The paying companies, from IN4' },
  { href: '/masters/projects?view=hub',      label: 'Projects (registry)',     module: '',                    area: 'masters', hint: 'Every hub project with its IN4 sub-projects, area and budget; the gaps' },
  { href: '/masters/categories?view=hub',    label: 'Work categories vs IN4',  module: '',                    area: 'masters', hint: 'The hub’s discipline codes against IN4’s' },
  { href: '/masters/mapping',                label: 'Project name mapping',    module: '',                    area: 'masters', hint: 'What IN4, the budget report, the procurement upload and Zoho call each project' },
  { href: '/cost-control/admin/disciplines', label: 'Work categories',         module: 'cost-control',        area: 'masters', hint: 'Disciplines and sub-skills used by every project' },
  { href: '/cost-control/projects/new',      label: 'New project',             module: 'cost-control',        area: 'masters', hint: 'Create a project with its code, group and approval chain' },

  // ── Data & imports ──
  { href: '/admin/manual-upload',            label: 'Manual upload (IN4 fallback)', module: '',               area: 'data', hint: 'If the live IN4 read fails: switch on, upload the Budget, contractor and supplier sheets by hand, switch off when IN4 is back' },
  { href: '/admin/in4',                      label: 'IN4 live sync',           module: '',                    area: 'data', hint: 'Every IN4 report the hub used to upload, read from IN4 twice a day; per-feed comparison and live switch' },
  { href: '/cost-control/import',            label: 'Cost Control import',     module: 'cost-control',        area: 'data', hint: 'Excel budget import and the BPH → project mapping' },
  { href: '/cost-control/import/bph',        label: 'BPH → project links',     module: 'cost-control',        area: 'data', hint: 'Which Budget-Hub project feeds which Internal Estimate' },
  { href: '/cost-control/audit',             label: 'Audit log',               module: 'cost-control',        area: 'data', hint: 'Who changed what, and when' },

  // ── Module settings ──
  { href: '/admin/dashboard-modules',        label: 'Modules on / off',        module: '',                    area: 'system', hint: 'Switch a module off for everyone, or rename it', ownerOnly: true },
  { href: '/admin/sidebar-groups',           label: 'Sidebar groups',          module: '',                    area: 'system', hint: 'Nest modules under names you choose', ownerOnly: true },
  { href: '/cost-control/settings',          label: 'Internal Estimate settings', module: 'cost-control',     area: 'system', hint: 'Feature switches, field names, engineer visibility, billing step' },
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
