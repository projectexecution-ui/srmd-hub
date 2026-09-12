// The Site Register's vocabulary — one place, so a word never differs between
// the table, the drawer, the phone card and an e-mail.
//
// Aksha, 12 Sep 2026: "just dont use Ball in our court or any casual words -
// better keep standard words". So the register speaks the way a construction
// document speaks: an entry is ASSIGNED TO someone, it has a RESPONSE DUE
// date, and it is OPEN, RESPONDED or CLOSED. No metaphors.
//
// Pure — no Supabase, no React — so it can be unit-tested and imported from
// both server and client, the same way lib/revamp/tabs.ts is.

import { todayIST } from '@/lib/utils'

/* ── What an entry is ───────────────────────────────────────────────────── */

export type ThreadKind = 'issue' | 'rfi' | 'instruction' | 'decision' | 'ncr' | 'correspondence'
export type ThreadStatus = 'open' | 'responded' | 'closed' | 'cancelled'
export type Priority = 'low' | 'normal' | 'high' | 'critical'

export interface KindDef {
  key: ThreadKind
  /** The reference prefix — SRAH/RFI/007. */
  code: string
  label: string
  /** Shown when raising: when a person should pick this one. */
  purpose: string
  /** Tailwind tone, resolved through TONES so colour is decided once. */
  tone: Tone
  /** Working days added to today for the default response date. */
  defaultDays: number
}

export type Tone = 'amber' | 'sky' | 'violet' | 'emerald' | 'rose' | 'slate'

/** The six kinds, in the order they appear when raising an entry. */
export const KINDS: KindDef[] = [
  { key: 'issue', code: 'SI', label: 'Site Issue', tone: 'amber', defaultDays: 3,
    purpose: 'Something on site needs attention or correction.' },
  { key: 'rfi', code: 'RFI', label: 'Request for Information', tone: 'sky', defaultDays: 5,
    purpose: 'An answer is required from design before work can proceed.' },
  { key: 'instruction', code: 'INS', label: 'Instruction', tone: 'violet', defaultDays: 1,
    purpose: 'A direction issued to a person, to act or to stop.' },
  { key: 'decision', code: 'DEC', label: 'Decision', tone: 'emerald', defaultDays: 5,
    purpose: 'A matter to be settled, and the record of what was settled.' },
  { key: 'ncr', code: 'NCR', label: 'Non-Conformance', tone: 'rose', defaultDays: 2,
    purpose: 'Executed work does not meet the approved specification.' },
  { key: 'correspondence', code: 'COR', label: 'Correspondence', tone: 'slate', defaultDays: 5,
    purpose: 'A letter, minute or note to be held on the project record.' },
]

export const KIND_BY_KEY: Record<ThreadKind, KindDef> =
  Object.fromEntries(KINDS.map(k => [k.key, k])) as Record<ThreadKind, KindDef>

export const kindLabel = (k: string): string => KIND_BY_KEY[k as ThreadKind]?.label ?? k
export const kindCode = (k: string): string => KIND_BY_KEY[k as ThreadKind]?.code ?? '—'
export const kindTone = (k: string): Tone => KIND_BY_KEY[k as ThreadKind]?.tone ?? 'slate'

export const STATUS_LABEL: Record<ThreadStatus, string> = {
  open: 'Open',
  responded: 'Responded',
  closed: 'Closed',
  cancelled: 'Cancelled',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low', normal: 'Normal', high: 'High', critical: 'Critical',
}

/** Priority in the order a person reads it — highest first in a sort. */
export const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, normal: 2, low: 3 }

/* ── Dates and ageing ───────────────────────────────────────────────────── */

const DAY = 86_400_000

/** Whole days between two ISO dates (yyyy-mm-dd), b − a. */
export function daysBetween(a: string, b: string): number {
  const x = Date.parse(a + 'T00:00:00Z'), y = Date.parse(b + 'T00:00:00Z')
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0
  return Math.round((y - x) / DAY)
}

/** Days an entry is past its response date. 0 when it is not. */
export function daysOverdue(dueOn: string | null | undefined, today = todayIST()): number {
  if (!dueOn) return 0
  const d = daysBetween(dueOn.slice(0, 10), today)
  return d > 0 ? d : 0
}

/** Days since it was last assigned — how long it has sat with this person. */
export function daysWaiting(assignedAt: string | null | undefined, nowMs = Date.now()): number {
  if (!assignedAt) return 0
  const t = Date.parse(assignedAt)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / DAY))
}

/**
 * The default response date for a new entry: the kind's own allowance, in
 * WORKING days, so a Friday issue is not silently due on Sunday. Saturday is
 * a working day on these sites; Sunday is not.
 */
export function defaultDueDate(kind: ThreadKind, from = todayIST()): string {
  const want = KIND_BY_KEY[kind]?.defaultDays ?? 3
  const d = new Date(from + 'T00:00:00Z')
  let added = 0
  while (added < want) {
    d.setUTCDate(d.getUTCDate() + 1)
    if (d.getUTCDay() !== 0) added++
  }
  return d.toISOString().slice(0, 10)
}

/** Is this entry still someone's to answer? */
export const isLive = (status: string): boolean => status === 'open' || status === 'responded'

/* ── How the register is read ───────────────────────────────────────────── */

export type RegisterFilter = 'mine' | 'overdue' | 'cost' | 'live' | 'closed'

export const FILTER_LABEL: Record<RegisterFilter, string> = {
  mine: 'Assigned to me',
  overdue: 'Overdue',
  cost: 'Cost impact',
  live: 'All open entries',
  closed: 'Closed',
}

export interface RegisterRow {
  id: string
  ref: string
  kind: ThreadKind
  title: string
  status: ThreadStatus
  priority: Priority
  projectId: string
  projectName: string
  categoryName: string | null
  subCategoryName: string | null
  disciplineName: string | null
  location: string | null
  assignedToId: string | null
  assignedToName: string | null
  assignedAt: string | null
  dueOn: string | null
  costImpact: number | null
  raisedById: string | null
  raisedByName: string | null
  createdAt: string
  lastActivityAt: string
  posts: number
  escalated: boolean
}

/** The register's own order: overdue first, then by priority, then oldest
 *  activity — the list a person should work down from the top. */
export function sortRegister(rows: RegisterRow[], today = todayIST()): RegisterRow[] {
  return [...rows].sort((a, b) => {
    const ao = daysOverdue(a.dueOn, today), bo = daysOverdue(b.dueOn, today)
    if ((ao > 0) !== (bo > 0)) return bo - ao > 0 ? 1 : -1
    if (ao !== bo) return bo - ao
    const ap = PRIORITY_RANK[a.priority] ?? 2, bp = PRIORITY_RANK[b.priority] ?? 2
    if (ap !== bp) return ap - bp
    return Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt)
  })
}

export function applyFilter(
  rows: RegisterRow[],
  filter: RegisterFilter,
  kind: ThreadKind | 'all',
  myId: string | null,
  today = todayIST(),
): RegisterRow[] {
  return rows.filter(r => {
    if (kind !== 'all' && r.kind !== kind) return false
    switch (filter) {
      case 'mine':    return isLive(r.status) && !!myId && r.assignedToId === myId
      case 'overdue': return isLive(r.status) && daysOverdue(r.dueOn, today) > 0
      case 'cost':    return r.costImpact != null && r.costImpact > 0
      case 'closed':  return r.status === 'closed' || r.status === 'cancelled'
      case 'live':    return isLive(r.status)
    }
  })
}

export interface RegisterSummary {
  mine: number
  overdue: number
  live: number
  costTotal: number
  costCount: number
  /** Average calendar days from raised to closed, over entries closed in the
   *  last 90 days. Null while nothing has been closed. */
  avgDaysToClose: number | null
}

export function summarise(
  rows: RegisterRow[],
  myId: string | null,
  closedDurations: number[] = [],
  today = todayIST(),
): RegisterSummary {
  const live = rows.filter(r => isLive(r.status))
  const withCost = rows.filter(r => isLive(r.status) && r.costImpact != null && r.costImpact > 0)
  return {
    mine: live.filter(r => !!myId && r.assignedToId === myId).length,
    overdue: live.filter(r => daysOverdue(r.dueOn, today) > 0).length,
    live: live.length,
    costTotal: withCost.reduce((s, r) => s + (r.costImpact ?? 0), 0),
    costCount: withCost.length,
    avgDaysToClose: closedDurations.length
      ? Math.round((closedDurations.reduce((s, d) => s + d, 0) / closedDurations.length) * 10) / 10
      : null,
  }
}

/* ── Stakeholders ───────────────────────────────────────────────────────── */

export type OrgKind = 'team' | 'consultant' | 'contractor' | 'vendor' | 'authority'

export const ORG_LABEL: Record<OrgKind, string> = {
  team: 'SRMD team',
  consultant: 'Consultants',
  contractor: 'Contractors',
  vendor: 'Vendors',
  authority: 'Authorities',
}

/** The order the groups are shown in — the project's own people first. */
export const ORG_ORDER: OrgKind[] = ['team', 'consultant', 'contractor', 'vendor', 'authority']

export interface Discipline { id: string; name: string; shortName: string | null; order: number }

export interface Stakeholder {
  id: string
  projectId: string
  disciplineId: string | null
  disciplineName: string | null
  orgKind: OrgKind
  userId: string | null
  in4PartyKind: string | null
  in4PartyId: number | null
  name: string
  roleOnProject: string | null
  email: string | null
  phone: string | null
  isLead: boolean
  isActive: boolean
  notes: string | null
  /** From IN4, by the party pin — never typed. */
  orderValue: number | null
  paid: number | null
  orders: number
}

/**
 * Disciplines that are switched on for the project but have nobody named, and
 * therefore nowhere for a query of that discipline to go. This is the check
 * that makes Stakeholders worth opening rather than a list to admire.
 */
export function coverageGaps(
  enabled: Discipline[],
  people: Stakeholder[],
): Discipline[] {
  const covered = new Set(people.filter(p => p.isActive && p.disciplineId).map(p => p.disciplineId as string))
  return enabled.filter(d => !covered.has(d.id))
}

/** Who a new entry of this discipline should be addressed to: the named lead,
 *  else the only active person in it, else nobody. */
export function defaultAssignee(
  disciplineId: string | null,
  people: Stakeholder[],
): Stakeholder | null {
  if (!disciplineId) return null
  const inDiscipline = people.filter(p => p.isActive && p.disciplineId === disciplineId)
  return inDiscipline.find(p => p.isLead) ?? (inDiscipline.length === 1 ? inDiscipline[0] : null)
}

/* ── Decisions & specifications ─────────────────────────────────────────── */

export type DecisionStatus = 'pending' | 'under_review' | 'approved' | 'superseded'

export const DECISION_LABEL: Record<DecisionStatus, string> = {
  pending: 'Pending',
  under_review: 'Under review',
  approved: 'Approved',
  superseded: 'Superseded',
}

export interface DecisionRow {
  id: string | null
  projectId: string
  categoryId: string
  categoryName: string
  categoryCode: string | null
  subCategoryId: string | null
  subCategoryName: string | null
  isApplicable: boolean
  status: DecisionStatus
  spec: string | null
  decidedByName: string | null
  decidedOn: string | null
  requiredBy: string | null
  ownerName: string | null
  revision: number
  /** An open entry in the register raised against this specification. */
  openRefs: string[]
}

export interface DecisionCategory {
  categoryId: string
  name: string
  code: string | null
  order: number
  rows: DecisionRow[]
}

/**
 * A specification that is not yet approved and is needed within the warning
 * window is FLAGGED — this is the one number that prevents a delay, so it is
 * computed in one place and used by the tree, the counters and the digest.
 */
export const FLAG_WINDOW_DAYS = 21

export function isFlagged(row: DecisionRow, today = todayIST()): boolean {
  if (!row.isApplicable || row.status === 'approved') return false
  if (!row.requiredBy) return false
  const left = daysBetween(today, row.requiredBy.slice(0, 10))
  return left <= FLAG_WINDOW_DAYS
}

export interface DecisionSummary {
  applicable: number
  total: number
  approved: number
  outstanding: number
  flagged: number
}

export function summariseDecisions(cats: DecisionCategory[], today = todayIST()): DecisionSummary {
  const all = cats.flatMap(c => c.rows)
  const applicable = all.filter(r => r.isApplicable)
  return {
    applicable: applicable.length,
    total: all.length,
    approved: applicable.filter(r => r.status === 'approved').length,
    outstanding: applicable.filter(r => r.status !== 'approved').length,
    flagged: applicable.filter(r => isFlagged(r, today)).length,
  }
}
