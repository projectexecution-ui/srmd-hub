// Budget shifting requests (cross-category transfers) — where each one is and
// who has it. Pure: rows in, tracker rows out, so it is unit-tested.
//
// Aksha, 10 Oct 2026: "Budget Shifting Request — Parimal and Atms should get
// the pending in Approvals pending, so they can track where it's stuck." The
// existing inbox (cc_transfer_inbox) only shows a request to whoever must act
// on it RIGHT NOW, never to the person who raised it — so Parimal lost sight of
// his own request the moment he raised it, and an Atm Head lost it the moment
// he signed. This tracker shows every open request, its step, who it is with
// and how long it has waited.
//
// The five steps a request walks, from cc_transfer_* RPCs (CT Head added
// first on 10 Oct 2026):
//   pending_ph → pending_atm → pending_trustee → awaiting_in4 → awaiting_sync → confirmed
// (rejected / cancelled close it.)

export const OPEN_TRANSFER_STATUSES = ['pending_ph', 'pending_atm', 'pending_trustee', 'awaiting_in4', 'awaiting_sync'] as const
export const TRANSFER_STEPS = OPEN_TRANSFER_STATUSES.length
export type OpenTransferStatus = typeof OPEN_TRANSFER_STATUSES[number]

export interface TrackerTransfer {
  id: string
  project_id: string
  status: string
  amount: number
  reason: string | null
  from_discipline_id: string
  from_sub_skill_id: string
  to_discipline_id: string
  to_sub_skill_id: string
  raised_by: string | null
  raised_at: string | null
  ph_by?: string | null
  ph_at?: string | null
  atm_by: string | null
  atm_at: string | null
  trustee_by: string | null
  trustee_at: string | null
  in4_at: string | null
  settle_note: string | null
}

export interface TrackerPerson { id: string; name: string; role: string | null; active: boolean }

export interface TrackerInput {
  transfers: TrackerTransfer[]
  projects: { id: string; code: string | null; name: string | null }[]
  /** cc_project_approvers rows for these projects (role 'project_head' / 'head' / 'founder'). */
  approvers: { project_id: string; user_id: string; role: string }[]
  /** Everyone, with their EFFECTIVE Cost Control role (override, else profile). */
  people: TrackerPerson[]
  disciplines: { id: string; code: string | null; name: string | null }[]
  subSkills: { id: string; code: string | null; name: string | null }[]
  /** The viewer. */
  viewer: { id: string; role: string | null; isAdmin: boolean }
  /** Transfer ids the viewer may approve now (from cc_transfer_inbox — the
   *  same rule the approve call enforces). */
  myApprovalIds: Set<string>
  now: number
}

export interface TrackerRow {
  id: string
  projectId: string
  projectLabel: string
  amount: number
  fromLabel: string
  toLabel: string
  reason: string | null
  status: OpenTransferStatus
  /** 1–5. */
  step: number
  /** "CT Head", "Atm Head", "Trustee", "Shift in IN4", "IN4 sync check". */
  stage: string
  /** Who has it now, in names — "Amit Gala", or "the next IN4 sync". */
  withWhom: string
  /** When it reached this step (ISO). */
  since: string | null
  /** Whole hours and days it has waited at this step. */
  waitedHours: number
  waitedDays: number
  /** Two days or more at one step reads as stuck. */
  stuck: boolean
  raisedBy: string | null
  raisedAt: string | null
  /** The steps still ahead, in words. */
  next: string[]
  /** The sync found a different figure — what actually moved. */
  settleNote: string | null
  /** The viewer is the one who must act now. */
  mine: boolean
  /** Where the viewer acts, when it is theirs. */
  actionHref: string | null
}

const STEP: Record<OpenTransferStatus, { n: number; stage: string }> = {
  pending_ph:      { n: 1, stage: 'CT Head' },
  pending_atm:     { n: 2, stage: 'Atm Head' },
  pending_trustee: { n: 3, stage: 'Trustee' },
  awaiting_in4:    { n: 4, stage: 'Shift in IN4' },
  awaiting_sync:   { n: 5, stage: 'IN4 sync check' },
}
const STEPS_AFTER: Record<OpenTransferStatus, string[]> = {
  pending_ph:      ['Atm Head', 'Trustee', 'shift in IN4', 'IN4 sync check'],
  pending_atm:     ['Trustee', 'shift in IN4', 'IN4 sync check'],
  pending_trustee: ['shift in IN4', 'IN4 sync check'],
  awaiting_in4:    ['IN4 sync check'],
  awaiting_sync:   [],
}

export function isOpenTransfer(status: string): status is OpenTransferStatus {
  return (OPEN_TRANSFER_STATUSES as readonly string[]).includes(status)
}

function lineLabel(
  discId: string, subId: string,
  disc: Map<string, { code: string | null; name: string | null }>,
  sub: Map<string, { code: string | null; name: string | null }>,
): string {
  const d = disc.get(discId), s = sub.get(subId)
  const dl = [d?.code, d?.name].filter(Boolean).join(' ')
  const sl = [s?.code, s?.name].filter(Boolean).join(' ')
  return dl && sl ? `${dl} › ${sl}` : sl || dl || '—'
}

/** Names, comma-separated, in a stable order. */
function names(people: TrackerPerson[]): string {
  return [...new Set(people.map(p => p.name))].sort((a, b) => a.localeCompare(b)).join(', ')
}

/** Which open requests the viewer may follow.
 *  Admin and the Coordinator: all. An Atm Head: the projects he is the named
 *  Atm Head on, projects with no named Atm Head, and anything he raised or
 *  signed. Everyone else: none. */
export function canFollow(t: TrackerTransfer, viewer: TrackerInput['viewer'], headProjects: Set<string>, projectsWithHead: Set<string>): boolean {
  if (viewer.isAdmin || viewer.role === 'coordinator') return true
  if (viewer.role !== 'head') return false
  return headProjects.has(t.project_id)
    || !projectsWithHead.has(t.project_id)
    || t.raised_by === viewer.id
    || t.atm_by === viewer.id
}

export function buildTransferTracker(input: TrackerInput): TrackerRow[] {
  const { viewer } = input
  const proj = new Map(input.projects.map(p => [p.id, p]))
  const disc = new Map(input.disciplines.map(d => [d.id, d]))
  const sub = new Map(input.subSkills.map(s => [s.id, s]))
  const person = new Map(input.people.map(p => [p.id, p]))
  const active = input.people.filter(p => p.active)

  const phsOf = new Map<string, TrackerPerson[]>()
  const headsOf = new Map<string, TrackerPerson[]>()
  const foundersOf = new Map<string, TrackerPerson[]>()
  for (const a of input.approvers) {
    const p = person.get(a.user_id)
    if (!p) continue
    const map = a.role === 'project_head' ? phsOf : a.role === 'head' ? headsOf : a.role === 'founder' ? foundersOf : null
    if (!map) continue
    map.set(a.project_id, [...(map.get(a.project_id) ?? []), p])
  }
  const headProjects = new Set(input.approvers.filter(a => a.role === 'head' && a.user_id === viewer.id).map(a => a.project_id))
  const projectsWithHead = new Set(input.approvers.filter(a => a.role === 'head').map(a => a.project_id))
  const allPHs = active.filter(p => p.role === 'project_head')
  const allHeads = active.filter(p => p.role === 'head')
  const allFounders = active.filter(p => p.role === 'founder')
  const in4People = active.filter(p => p.role === 'billing' || p.role === 'coordinator')
  const canKeyIn4 = viewer.isAdmin || viewer.role === 'billing' || viewer.role === 'coordinator'

  const rows: TrackerRow[] = []
  for (const t of input.transfers) {
    if (!isOpenTransfer(t.status)) continue
    if (!canFollow(t, viewer, headProjects, projectsWithHead)) continue
    const st = STEP[t.status]

    let withWhom: string
    let since: string | null
    if (t.status === 'pending_ph') {
      withWhom = names(phsOf.get(t.project_id) ?? allPHs) || 'the CT Head'
      since = t.raised_at
    } else if (t.status === 'pending_atm') {
      withWhom = names(headsOf.get(t.project_id) ?? allHeads) || 'the Atm Head'
      since = t.ph_at ?? t.raised_at
    } else if (t.status === 'pending_trustee') {
      withWhom = names(foundersOf.get(t.project_id) ?? allFounders) || 'the Trustee'
      since = t.atm_at ?? t.ph_at ?? t.raised_at
    } else if (t.status === 'awaiting_in4') {
      withWhom = names(in4People) || 'Billing'
      since = t.trustee_at ?? t.atm_at ?? t.raised_at
    } else {
      withWhom = 'the next IN4 sync'
      since = t.in4_at ?? t.trustee_at ?? t.raised_at
    }

    const sinceMs = since ? Date.parse(since) : NaN
    const waitedMs = Number.isNaN(sinceMs) ? 0 : Math.max(0, input.now - sinceMs)
    const waitedHours = Math.floor(waitedMs / 3_600_000)
    const waitedDays = Math.floor(waitedMs / 86_400_000)

    const mine = (t.status === 'pending_ph' || t.status === 'pending_atm' || t.status === 'pending_trustee')
      ? input.myApprovalIds.has(t.id)
      : t.status === 'awaiting_in4' ? canKeyIn4 : false
    const actionHref = !mine ? null
      : t.status === 'awaiting_in4' ? '/cost-control/billing'
      : '/cost-control/approvals'

    const p = proj.get(t.project_id)
    const projectLabel = p?.code && p?.name && p.code !== p.name ? `${p.code} · ${p.name}` : (p?.code || p?.name || 'Project')
    const raiser = t.raised_by ? person.get(t.raised_by) : undefined

    rows.push({
      id: t.id,
      projectId: t.project_id,
      projectLabel,
      amount: Number(t.amount) || 0,
      fromLabel: lineLabel(t.from_discipline_id, t.from_sub_skill_id, disc, sub),
      toLabel: lineLabel(t.to_discipline_id, t.to_sub_skill_id, disc, sub),
      reason: t.reason,
      status: t.status,
      step: st.n,
      stage: st.stage,
      withWhom,
      since,
      waitedHours,
      waitedDays,
      stuck: waitedDays >= 2,
      raisedBy: raiser?.name ?? null,
      raisedAt: t.raised_at,
      next: STEPS_AFTER[t.status],
      settleNote: t.status === 'awaiting_sync' ? t.settle_note : null,
      mine,
      actionHref,
    })
  }
  // Longest-waiting first: what is stuck is what the reader came for.
  return rows.sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''))
}

/** "3 h", "2 days" — how long at this step, in words. */
export function waitedLabel(r: Pick<TrackerRow, 'waitedHours' | 'waitedDays'>): string {
  if (r.waitedDays >= 1) return `${r.waitedDays} day${r.waitedDays === 1 ? '' : 's'}`
  if (r.waitedHours >= 1) return `${r.waitedHours} h`
  return 'under an hour'
}
