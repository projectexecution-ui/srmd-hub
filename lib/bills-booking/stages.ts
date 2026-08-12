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
}

// The forward pipeline, in order. on_hold / rejected are off-pipeline states.
export const PIPELINE: StageDef[] = [
  { key: 'submitted',    label: 'Submitted',        desk: 'ERP entry team',           next: 'site_head',    tone: 'slate' },
  { key: 'site_head',    label: 'Site Head',        desk: 'Site Head check',          next: 'disc_head',    tone: 'blue' },
  { key: 'disc_head',    label: 'CT Disc Head',     desk: 'Civil / MEP discipline',   next: 'ct_head',      tone: 'indigo' },
  { key: 'ct_head',      label: 'CT Head',          desk: 'CT Head verification',     next: 'atm_approval', tone: 'violet' },
  { key: 'atm_approval', label: 'Atm approval',     desk: 'Atm Head',                 next: 'ct_billing',   tone: 'amber' },
  { key: 'ct_billing',   label: 'CT Billing',       desk: 'Payment certificate (IN4)', next: 'atm_in4',     tone: 'teal' },
  { key: 'atm_in4',      label: 'Atm (IN4)',        desk: 'Atm approves in IN4',      next: 'trust',        tone: 'cyan' },
  { key: 'trust',        label: 'At Trust A/c',     desk: 'Trust Accounts',           next: 'paid',         tone: 'blue' },
  { key: 'paid',         label: 'Paid',             desk: 'Done',                     tone: 'green' },
]

export const OFF_PIPELINE: StageDef[] = [
  { key: 'on_hold',  label: 'On hold',  desk: 'Parked',      tone: 'gray' },
  { key: 'rejected', label: 'Rejected', desk: 'Sent back',   tone: 'rose' },
]

const ALL: Record<BbStage, StageDef> = Object.fromEntries(
  [...PIPELINE, ...OFF_PIPELINE].map(s => [s.key, s]),
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

// Days a bill should sit at each desk before it's "late" (SLA). Tune later /
// make configurable. Off-pipeline stages have no SLA.
export const SLA_DAYS: Partial<Record<BbStage, number>> = {
  submitted: 1, site_head: 2, disc_head: 2, ct_head: 3,
  atm_approval: 2, ct_billing: 2, atm_in4: 2, trust: 7,
}
export function slaFor(k: BbStage): number | undefined {
  return SLA_DAYS[k]
}
