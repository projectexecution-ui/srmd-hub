// THE list of everything an admin can change in CT Hub — one list, one name
// per screen, five doors.
//
// Aksha, 23 Sep 2026: "there are so many Settings - i am getting confused -
// so many overlapping". The audit behind that found 34 admin screens fed to
// two different Admin homes from two different lists (lib/admin-registry.ts
// and lib/revamp/admin-map.ts), five of them named differently on each, and
// a fold that offered the same screens three ways. His decisions, all built:
//
//   A1  Today strip + five doors, nothing else — no fold, no A–Z, no job
//       checklists, no "Old screens" list. A search box for anyone who knows
//       a screen's name.
//   B1  Messages: seven screens into one, five tabs. /admin/email retired —
//       it was a copy of Who receives what.
//   C1  People absorbs Users and Permissions as tabs.
//   D1  Signing rules, Bills desks and Tracker visibility become tabs of
//       Projects, with New project beside them.
//   E1  One Data door: IN4 · Manual fallback · Imports · Masters · Deleted
//       things. Masters leaves the sidebar.
//   F1  One list (this file). The CT Hub V1 toggle keeps the old sidebar but
//       shows this same Admin home.
//   G   Housekeeping: the dead /admin/settings route goes (its slug stays as
//       the permission for these doors), "Old screens" goes, the V1 sidebar's
//       separate "Modules" shortcut goes, and it is "Internal Estimate
//       settings" everywhere.
//   H1  Today reads the actual run log (lib/admin/today.ts).
//
// Every screen keeps working at its old address: `was` lists the addresses
// that now open a tab, and each of those routes redirects here. Nothing an
// admin could do before is gone; it has one door instead of three.
//
// Pure data and pure functions, so the gates are testable without a browser.

export type DoorId = 'people' | 'projects' | 'messages' | 'data' | 'hub'

/** Who may see a door or a tab. The doors never widen access: every gate
 *  here is one the underlying screen already required. */
export type Gate = 'anyone' | 'cc-view' | 'settings-view' | 'cc-admin' | 'admin' | 'owner'

export interface Viewer {
  /** Portal Owner or role admin. */
  admin: boolean
  owner: boolean
  /** can(admin-settings, view) — Trustee and Back Office hold this today. */
  settingsView: boolean
  /** can(cost-control, admin) — Trustee and the coordinator as well as admin. */
  ccAdmin: boolean
  /** can(cost-control, view) — nearly everyone. */
  ccView: boolean
}

export interface DoorTab {
  id: string
  label: string
  /** One line, in the words of what it is FOR. */
  hint: string
  gate: Gate
  /** Old addresses that now open this tab (each route redirects here). */
  was?: readonly string[]
}

export interface Door {
  id: DoorId
  href: string
  label: string
  hint: string
  gate: Gate
  tabs: readonly DoorTab[]
}

export const DOORS: readonly Door[] = [
  {
    id: 'people', href: '/admin/people', label: 'People', gate: 'admin',
    hint: 'Who is in the hub, what each person may open and do, how they are alerted.',
    tabs: [
      { id: 'people',   label: 'Per person',     gate: 'admin', hint: 'One card per person — or the six grids, for changing many at once' },
      { id: 'accounts', label: 'Accounts',       gate: 'admin', hint: 'Sign-ins, roles, access requests, the invite link', was: ['/admin/users'] },
      { id: 'roles',    label: 'Roles & powers', gate: 'admin', hint: 'What each role may open and do — the role × screen grid', was: ['/admin/permissions'] },
    ],
  },
  {
    id: 'projects', href: '/admin/projects', label: 'Projects', gate: 'admin',
    hint: 'Who signs each project, who works on it, who sees its indents, who holds its desks.',
    tabs: [
      { id: 'projects', label: 'Per project',        gate: 'admin', hint: 'One card per project: who signs each stage, who works on it' },
      { id: 'signing',  label: 'Signing rules',      gate: 'admin', hint: 'Who may move a document to the next stage, per module', was: ['/admin/approvals'] },
      { id: 'desks',    label: 'Bills desks',        gate: 'admin', hint: 'Who works each desk, per sub-project' },
      { id: 'tracker',  label: 'Tracker visibility', gate: 'admin', hint: 'Which projects each person sees in the Indent → PO tracker' },
    ],
  },
  {
    id: 'messages', href: '/admin/messages', label: 'Messages', gate: 'settings-view',
    hint: 'Everything the hub sends: on or off, to whom, when it last went, send it now.',
    tabs: [
      { id: 'scheduled',  label: 'Scheduled reports', gate: 'settings-view', hint: 'Every report and digest — channels, recipients, last sent, send now', was: ['/admin/reports'] },
      { id: 'alerts',     label: 'Instant alerts',    gate: 'admin',         hint: 'Each alert on or off per channel and role; who may manage their own', was: ['/admin/notifications'] },
      { id: 'recipients', label: 'Who receives what', gate: 'admin',         hint: 'Every message with its recipient list, edited in one place', was: ['/admin/notifications/recipients', '/admin/email'] },
      { id: 'mute',       label: 'Mute list',         gate: 'admin',         hint: 'Every person against every message — tap to mute, tap to restore' },
      { id: 'health',     label: 'Job health',        gate: 'settings-view', hint: 'Did the scheduled jobs and the IN4 feeds run, and did the e-mails go' },
    ],
  },
  {
    id: 'data', href: '/admin/data', label: 'Data', gate: 'cc-view',
    hint: 'IN4, imports, the lists everything points at, and anything deleted.',
    tabs: [
      { id: 'in4',      label: 'IN4 live sync',   gate: 'settings-view', hint: 'Every IN4 feed: last run, comparison with the old upload, live switch', was: ['/admin/in4'] },
      { id: 'fallback', label: 'Manual fallback', gate: 'admin',         hint: 'When IN4 cannot be read: switch on, upload the sheets by hand, switch off after' },
      { id: 'imports',  label: 'Imports',         gate: 'cc-admin',      hint: 'The Excel budget import and the BPH → project links' },
      { id: 'masters',  label: 'Masters',         gate: 'cc-view',       hint: 'Contacts, items, stores, trusts, projects and work categories — IN4’s register against the hub’s lists' },
      { id: 'deleted',  label: 'Deleted things',  gate: 'admin',         hint: 'Delete requests waiting, the recycle bin, and who changed what', was: ['/admin/delete-requests', '/admin/recycle-bin'] },
    ],
  },
  {
    id: 'hub', href: '/admin/hub', label: 'Hub', gate: 'cc-admin',
    hint: 'Rare switches for the whole app.',
    tabs: [
      { id: 'modules',  label: 'Modules on / off',           gate: 'owner',    hint: 'Switch a module off for everyone, or rename it', was: ['/admin/dashboard-modules'] },
      { id: 'sidebar',  label: 'Sidebar groups',             gate: 'admin',    hint: 'Nest modules under names you choose', was: ['/admin/sidebar-groups'] },
      { id: 'estimate', label: 'Internal Estimate settings', gate: 'cc-admin', hint: 'Feature switches, field names, engineer visibility, the billing step' },
      { id: 'general',  label: 'General',                    gate: 'admin',    hint: 'The CT Hub V1 toggle and the admin e-mail', was: ['/admin/settings'] },
    ],
  },
]

export function canOpen(gate: Gate, v: Viewer): boolean {
  switch (gate) {
    case 'anyone': return true
    case 'cc-view': return v.ccView || v.admin || v.owner
    case 'settings-view': return v.settingsView || v.admin || v.owner
    case 'cc-admin': return v.ccAdmin || v.admin || v.owner
    case 'admin': return v.admin || v.owner
    case 'owner': return v.owner
  }
}

export function doorById(id: string): Door | undefined {
  return DOORS.find(d => d.id === id)
}

export function visibleTabs(door: Door, v: Viewer): DoorTab[] {
  if (!canOpen(door.gate, v)) return []
  return door.tabs.filter(t => canOpen(t.gate, v))
}

/** A door is offered only when at least one of its tabs would open. */
export function visibleDoors(v: Viewer): Door[] {
  return DOORS.filter(d => visibleTabs(d, v).length > 0)
}

export function tabHref(door: Door | DoorId, tabId: string): string {
  const d = typeof door === 'string' ? doorById(door)! : door
  return `${d.href}?tab=${tabId}`
}

/** The tab a request lands on: the one asked for if it exists and opens, else
 *  the first the viewer may open, else null (nothing here for this person). */
export function resolveTab(door: Door, requested: string | undefined, v: Viewer): DoorTab | null {
  const open = visibleTabs(door, v)
  if (open.length === 0) return null
  return open.find(t => t.id === requested) ?? open[0]
}

/** Where an old address now lives, or null when it is not one we moved. */
export function legacyTarget(path: string): string | null {
  const clean = path.split('?')[0].replace(/\/$/, '')
  for (const d of DOORS) for (const t of d.tabs) if (t.was?.includes(clean)) return tabHref(d, t.id)
  return null
}

export interface SearchHit { door: Door; tab: DoorTab; href: string }

/** Every tab this viewer may open, for the search box; filtered by a query
 *  against label, hint and door name when one is given. */
export function searchTabs(q: string, v: Viewer): SearchHit[] {
  const needle = q.trim().toLowerCase()
  const out: SearchHit[] = []
  for (const d of visibleDoors(v)) {
    for (const t of visibleTabs(d, v)) {
      const hay = `${d.label} ${t.label} ${t.hint}`.toLowerCase()
      if (!needle || hay.includes(needle)) out.push({ door: d, tab: t, href: tabHref(d, t.id) })
    }
  }
  return out
}

/** Every old address that redirects into a door — for the test that checks
 *  each still has a route file, so no bookmark breaks. */
export function legacyPaths(): string[] {
  return DOORS.flatMap(d => d.tabs.flatMap(t => [...(t.was ?? [])]))
}
