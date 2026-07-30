// Pure helpers for the Daily Site Report status ladder + attention engine.
// Mirrors lib/bills-pipeline/transform.ts: a `daysSince` day-counter plus
// threshold-driven flags sourced from one central config. No side effects,
// no Date.now in the signature (callers may pass `today` for testability).

import type { DsrReport } from '@/lib/types'

/** Tunable SLAs (days). One place, like BP_CONFIG. */
export const DSR_CONFIG = {
  CHECK_SLA: 1,       // check received material against the bill
  BILL_TO_CT_SLA: 2,  // submit the stamped bill to the CT office
  PAY_START_SLA: 5,   // after bill→CT, payment should have started
  PAY_DONE_SLA: 7,    // after payment starts, it should be paid
  GRN_SLA: 3,         // after paid, GRN should be filled
} as const

// ── Stage ──────────────────────────────────────────────────────────
export type DsrStageKey = 'received' | 'bill_with_ct' | 'payment' | 'grn' | 'paid'

export interface DsrStage {
  key: DsrStageKey
  label: string
}

const STAGE_LABEL: Record<DsrStageKey, string> = {
  received: 'Received',
  bill_with_ct: 'Bill with CT',
  payment: 'Payment started',
  grn: 'GRN done',
  paid: 'Paid',
}

type LadderFlags = Pick<DsrReport,
  'bill_submitted_to_ct' | 'payment_started' | 'grn_done' | 'paid'>

/** Furthest milestone reached (checked-vs-bill is a tick on Received, not a stage). */
export function deriveStage(r: LadderFlags): DsrStage {
  let key: DsrStageKey = 'received'
  if (r.bill_submitted_to_ct) key = 'bill_with_ct'
  if (r.payment_started) key = 'payment'
  if (r.grn_done) key = 'grn'
  if (r.paid) key = 'paid'
  return { key, label: STAGE_LABEL[key] }
}

/** A delivery is fully closed out only when it is both GRN'd and paid. */
export function isComplete(r: Pick<DsrReport, 'grn_done' | 'paid'>): boolean {
  return r.grn_done && r.paid
}

// ── Day counter (UTC-safe, clamps at 0) ─────────────────────────────
export function daysSince(iso: string | null | undefined, todayIso?: string): number {
  if (!iso) return 0
  const d = new Date(iso.length <= 10 ? iso + 'T00:00:00Z' : iso)
  if (isNaN(d.getTime())) return 0
  const now = todayIso
    ? new Date(todayIso.length <= 10 ? todayIso + 'T00:00:00Z' : todayIso)
    : new Date()
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000))
}

// ── Attention engine ────────────────────────────────────────────────
export type Severity = 'none' | 'ok' | 'warn' | 'urgent'

export interface DsrAttention {
  severity: Severity
  /** Human label for the current bottleneck. */
  label: string
  /** Days waiting at the current bottleneck step. */
  waitingDays: number
}

type AttentionFields = Pick<DsrReport,
  'received_on' | 'checked_against_bill' | 'bill_submitted_to_ct' | 'bill_submitted_to_ct_on'
  | 'payment_started' | 'payment_started_on' | 'grn_done' | 'paid' | 'paid_on'>

/**
 * Walks the chain front-to-back and reports the first incomplete step as the
 * bottleneck, with how long it's been waiting and how badly it's over SLA.
 * This is what the smart checklist sorts + colours on.
 */
export function deriveAttention(r: AttentionFields, todayIso?: string): DsrAttention {
  if (r.grn_done && r.paid) return { severity: 'none', label: 'Complete', waitingDays: 0 }

  let since: string | null
  let sla: number
  let label: string

  if (!r.bill_submitted_to_ct) {
    since = r.received_on
    sla = DSR_CONFIG.BILL_TO_CT_SLA
    label = 'Bill not sent to CT'
  } else if (!r.payment_started) {
    since = r.bill_submitted_to_ct_on ?? r.received_on
    sla = DSR_CONFIG.PAY_START_SLA
    label = 'Payment not started'
  } else if (!r.paid) {
    since = r.payment_started_on ?? r.bill_submitted_to_ct_on ?? r.received_on
    sla = DSR_CONFIG.PAY_DONE_SLA
    label = 'Payment pending'
  } else {
    // paid but GRN still pending
    since = r.paid_on
    sla = DSR_CONFIG.GRN_SLA
    label = 'GRN pending'
  }

  const waitingDays = daysSince(since, todayIso)
  let severity: Severity = 'ok'
  if (waitingDays > sla * 2) severity = 'urgent'
  else if (waitingDays > sla) severity = 'warn'
  return { severity, label, waitingDays }
}

export function needsAttention(a: DsrAttention): boolean {
  return a.severity === 'warn' || a.severity === 'urgent'
}

// ── Tick-strip + ladder builders ────────────────────────────────────
export interface DsrStep {
  key: string
  label: string
  done: boolean
  on: string | null
}

type StepFields = Pick<DsrReport,
  'received_on' | 'checked_against_bill' | 'checked_against_bill_on'
  | 'bill_submitted_to_ct' | 'bill_submitted_to_ct_on'
  | 'payment_started' | 'payment_started_on'
  | 'grn_done' | 'grn_done_on' | 'paid' | 'paid_on'>

/** Six-step tick strip for a compact row summary. */
export function deriveSteps(r: StepFields): DsrStep[] {
  return [
    { key: 'received', label: 'Received',   done: true,                    on: r.received_on },
    { key: 'checked',  label: 'Checked',    done: r.checked_against_bill,  on: r.checked_against_bill_on },
    { key: 'bill_ct',  label: 'Bill w/ CT', done: r.bill_submitted_to_ct,  on: r.bill_submitted_to_ct_on },
    { key: 'payment',  label: 'Payment',    done: r.payment_started,       on: r.payment_started_on },
    { key: 'grn',      label: 'GRN',        done: r.grn_done,              on: r.grn_done_on },
    { key: 'paid',     label: 'Paid',       done: r.paid,                  on: r.paid_on },
  ]
}

/**
 * The editable ladder shown on the detail screen. `flag` is the boolean and
 * `dateField` its matching *_on date — both keys on DsrReport so the toggle
 * handler can set { [flag]: value, [dateField]: value ? today : null }.
 */
export const DSR_LADDER: Array<{
  flag: keyof DsrReport
  dateField: keyof DsrReport
  label: string
  hint?: string
}> = [
  { flag: 'checked_against_bill', dateField: 'checked_against_bill_on', label: 'Checked against bill', hint: 'Material tallied with the supplier bill' },
  { flag: 'bill_submitted_to_ct', dateField: 'bill_submitted_to_ct_on', label: 'Stamped bill submitted to CT office' },
  { flag: 'payment_started',      dateField: 'payment_started_on',      label: 'Payment process started (IN4)' },
  { flag: 'grn_done',             dateField: 'grn_done_on',             label: 'GRN filled' },
  { flag: 'paid',                 dateField: 'paid_on',                 label: 'Paid', hint: 'Payment completed' },
]
