// "Who may do what on this project" — the one question, and the six tables
// that currently answer it.
//
// WHY THIS EXISTS. Six tables, edited from five screens, hold 124 rows between
// them, and every one of them is really the same row: a person, a project, and
// one capability. Nobody could see the whole picture for one project, which is
// how an engineer ended up with access nobody meant to grant and how three
// projects ended up with no approver at all.
//
// This file does not migrate anything. It states the shape they all share, so
// ONE panel can read and write all six — and so the eventual merge into a
// single table is a data move rather than a redesign.

export type CapabilityId =
  | 'approver' | 'works_on' | 'jmr_log' | 'sees_indents' | 'bill_desk'

export interface Capability {
  id: CapabilityId
  /** ≤5 words — the V1 label rule. */
  label: string
  hint: string
  /** The table that holds it today. */
  table: string
  /**
   * How the row finds its project.
   *
   * 'id'   — a real foreign key. Safe.
   * 'name' — matched on the IN4 project NAME as text. Fragile: rename the
   *          project and the grant silently detaches. Called out on screen
   *          rather than hidden, because it is a real hazard.
   */
  keyedBy: 'id' | 'name'
  /** The screen this capability is edited on today — the one being replaced. */
  replaces: string
  /** Capabilities that carry a value as well as a yes/no. */
  variants?: readonly string[]
}

export const CAPABILITIES: readonly Capability[] = [
  {
    id: 'approver',
    label: 'Approves budgets',
    hint: 'Signs off working sheets for this project',
    table: 'cc_project_approvers',
    keyedBy: 'id',
    replaces: '/cost-control/projects/[id]/setup',
    variants: ['head', 'project_head', 'founder'],
  },
  {
    id: 'works_on',
    label: 'Works on it',
    hint: 'Assigned to the project, optionally to certain categories',
    table: 'project_assignments',
    keyedBy: 'id',
    replaces: '/admin/users',
  },
  {
    id: 'jmr_log',
    label: 'Logs JMR',
    hint: 'May record measured work against this site',
    table: 'jmr_user_project_access',
    keyedBy: 'id',
    replaces: '/jmr/admin/access',
  },
  {
    id: 'sees_indents',
    label: 'Sees indents',
    hint: 'This project appears in their Indent → PO tracker',
    table: 'procurement_user_project_visibility',
    keyedBy: 'name',
    replaces: '/procurement-tracker/admin',
  },
  {
    id: 'bill_desk',
    label: 'Works a bill desk',
    hint: 'Handles bills at one desk on this project',
    table: 'bb_desk_members',
    keyedBy: 'id',
    replaces: '/bills-booking/admin',
  },
] as const

export function capability(id: CapabilityId): Capability {
  const c = CAPABILITIES.find(x => x.id === id)
  if (!c) throw new Error(`Unknown capability "${id}"`)
  return c
}

/** Capabilities whose grant is keyed on a text name and can silently detach. */
export function fragileCapabilities(): Capability[] {
  return CAPABILITIES.filter(c => c.keyedBy === 'name')
}

/** One person's standing on one project. */
export interface PersonOnProject {
  userId: string
  name: string
  email: string
  role: string
  /** capability → true, or the variant string where it carries one. */
  has: Partial<Record<CapabilityId, string | true>>
}

export interface RawGrants {
  approvers: Array<{ user_id: string; role: string | null }>
  assignments: Array<{ user_id: string }>
  jmrAccess: Array<{ user_id: string }>
  /** Already filtered to this project's names by the caller. */
  indentViewers: Array<{ user_id: string }>
  deskMembers: Array<{ user_id: string; desk: string | null }>
}

export interface Person { id: string; full_name: string | null; email: string | null; role: string }

/**
 * Fold the six sources into one row per person.
 *
 * Only people who HAVE something are returned — a project with 13 accounts and
 * 2 grants should read as two lines, not thirteen mostly-empty ones. The panel
 * adds people from a picker.
 */
export function mergeGrants(people: Person[], raw: RawGrants): PersonOnProject[] {
  const byId = new Map(people.map(p => [p.id, p]))
  const out = new Map<string, PersonOnProject>()

  const touch = (userId: string): PersonOnProject | null => {
    const p = byId.get(userId)
    if (!p) return null // a grant for a deleted/inactive account — ignore, do not crash
    let row = out.get(userId)
    if (!row) {
      row = {
        userId,
        name: p.full_name?.trim() || p.email || 'Unnamed',
        email: p.email ?? '',
        role: p.role,
        has: {},
      }
      out.set(userId, row)
    }
    return row
  }

  for (const a of raw.approvers) {
    const r = touch(a.user_id)
    if (r) r.has.approver = a.role?.trim() || true
  }
  for (const a of raw.assignments) {
    const r = touch(a.user_id)
    if (r) r.has.works_on = true
  }
  for (const a of raw.jmrAccess) {
    const r = touch(a.user_id)
    if (r) r.has.jmr_log = true
  }
  for (const a of raw.indentViewers) {
    const r = touch(a.user_id)
    if (r) r.has.sees_indents = true
  }
  for (const a of raw.deskMembers) {
    const r = touch(a.user_id)
    if (r) r.has.bill_desk = a.desk?.trim() || true
  }

  // Approvers first — they are the ones whose absence blocks work — then by
  // how much someone does, then by name so the order is stable.
  return [...out.values()].sort((a, b) => {
    if (!!a.has.approver !== !!b.has.approver) return a.has.approver ? -1 : 1
    const n = Object.keys(b.has).length - Object.keys(a.has).length
    return n !== 0 ? n : a.name.localeCompare(b.name)
  })
}

/** Nobody can sign off — the state that silently stalls every budget raised. */
export function hasNoApprover(rows: PersonOnProject[]): boolean {
  return !rows.some(r => r.has.approver)
}

/** How many separate screens this panel saves a trip to. */
export function screensReplaced(): number {
  return new Set(CAPABILITIES.map(c => c.replaces)).size
}
