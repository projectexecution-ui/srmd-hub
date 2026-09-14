// Bills Booking — the stage spine (mirrors the Zoho flow), one source of truth
// for labels, order, the desk that holds each stage, and the default next stage.
// Owner-gating (who can move from where) is layered on later; for now every move
// is permission-gated to bills-booking edit.

export type BbStage =
  | 'submitted' | 'site_head' | 'disc_head' | 'ct_head'
  | 'atm_approval' | 'ct_billing' | 'atm_in4' | 'trust' | 'paid'
  | 'on_hold' | 'rejected'

export interface StageDef {
  key: BbStage
  label: string       // short label
  desk: string        // who holds it
  next?: BbStage      // the default "forward" target
  tone: 'slate' | 'blue' | 'indigo' | 'violet' | 'amber' | 'teal' | 'cyan' | 'green' | 'gray' | 'rose'
  /** Followed, not owned. The bill has left CT and sits with Entity Trust
   *  Accounts; the days are still counted so a delay is visible, but nothing
   *  here is called late, because nobody at CT can act on it. */
  tracking?: boolean
}

/** The forward pipeline, in order. on_hold / rejected are off-pipeline states.
 *
 *  Two changes on 14 Sep 2026, both catching the spine up with decisions Aksha
 *  made on the 13th and which the screens had been contradicting ever since:
 *
 *  · **"Atm (IN4)" is gone.** The Atm Head no longer approves in IN4 — the CT
 *    Hub click is the approval of record and CT Billing keys IN4 afterwards.
 *    Every bill was showing a step that nobody performs. The key survives in
 *    LEGACY so an old row still renders instead of crashing.
 *
 *  · **Trust and Paid are marked `tracking`.** Aksha: work ends at Approved;
 *    Entity Trust Accounts take it on from there, and the Paid entry is made
 *    sometimes by them and sometimes by CT. They stay on the ladder because
 *    the money is still followed — but they are not our desks, so the days
 *    there are counted and never coloured as late. */
export const PIPELINE: StageDef[] = [
  { key: 'submitted',    label: 'Entered',          desk: 'ERP entry team',           next: 'site_head',    tone: 'slate' },
  { key: 'site_head',    label: 'Site Head',        desk: 'Site Head check',          next: 'disc_head',    tone: 'blue' },
  { key: 'disc_head',    label: 'CT Disc Head',     desk: 'Civil / MEP discipline',   next: 'ct_head',      tone: 'indigo' },
  { key: 'ct_head',      label: 'CT Head',          desk: 'CT Head verification',     next: 'atm_approval', tone: 'violet' },
  { key: 'atm_approval', label: 'Atm approval',     desk: 'Atm Head',                 next: 'ct_billing',   tone: 'amber' },
  { key: 'ct_billing',   label: 'CT Billing',       desk: 'Payment certificate (IN4)', next: 'trust',       tone: 'teal' },
  { key: 'trust',        label: 'At Trust A/c',     desk: 'Entity Trust Accounts',    next: 'paid',         tone: 'blue', tracking: true },
  { key: 'paid',         label: 'Paid',             desk: 'Done',                     tone: 'green',        tracking: true },
]

export const OFF_PIPELINE: StageDef[] = [
  { key: 'on_hold',  label: 'On hold',  desk: 'Parked',      tone: 'gray' },
  { key: 'rejected', label: 'Rejected', desk: 'Sent back',   tone: 'rose' },
]

/** Retired stages. Not on the ladder and not offered as a forward step, but
 *  still resolvable, because a bill parked at one before the change must not
 *  render as a blank label. */
export const LEGACY: StageDef[] = [
  { key: 'atm_in4', label: 'Atm (IN4) — retired', desk: 'no longer used', tone: 'gray' },
]

const ALL: Record<BbStage, StageDef> = Object.fromEntries(
  [...PIPELINE, ...OFF_PIPELINE, ...LEGACY].map(s => [s.key, s]),
) as Record<BbStage, StageDef>

export function stageDef(k: BbStage): StageDef {
  return ALL[k] ?? { key: k, label: k, desk: '', tone: 'gray' }
}
export function stageIndex(k: BbStage): number {
  return PIPELINE.findIndex(s => s.key === k)
}
export function nextStage(k: BbStage): BbStage | undefined {
  return stageDef(k).next
}
// Prior pipeline stage — the default "send back" target.
export function prevStage(k: BbStage): BbStage | undefined {
  const i = stageIndex(k)
  return i > 0 ? PIPELINE[i - 1].key : undefined
}
export const isTerminal = (k: BbStage) => k === 'paid' || k === 'rejected'

/** Days a bill may sit at a desk before it counts as late.
 *
 *  These are a first guess, not an agreed standard — Aksha has never signed
 *  them off, and they drive the "Over SLA" count on the home page and the red
 *  on the timeline, so they are worth an argument. To change one, edit the
 *  number here; to stop a desk ever being called late, remove its line.
 *
 *  `trust` and `paid` have none on purpose: the bill has left CT by then, and
 *  colouring a delay red at a desk nobody here can act on just trains people
 *  to ignore red. The days are still shown. */
export const SLA_DAYS: Partial<Record<BbStage, number>> = {
  submitted: 1, site_head: 2, disc_head: 2, ct_head: 3,
  atm_approval: 2, ct_billing: 2,
}
export function slaFor(k: BbStage): number | undefined {
  return SLA_DAYS[k]
}

/** How long a bill has sat where it is.
 *
 *  The clock defaults here rather than in the page, because a component that
 *  calls `Date.now()` is impure — the linter flags it, and it is right to:
 *  a re-render silently produces a different number. Both take `now` so a test
 *  can pin it. */
export function daysAtStage(since: string | null | undefined, now: number = Date.now()): number {
  if (!since) return 0
  const t = new Date(since).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (now - t) / 86_400_000)
}

/** Late — meaning somebody at CT can act and has not.
 *
 *  A stage with no SLA is never late. That covers Trust and Paid on purpose:
 *  the bill has left CT, and colouring a delay red at a desk nobody here can
 *  move only teaches people to ignore red. */
export function isOverSla(stage: BbStage, since: string | null | undefined, now: number = Date.now()): boolean {
  const limit = slaFor(stage)
  return limit != null && daysAtStage(since, now) > limit
}
