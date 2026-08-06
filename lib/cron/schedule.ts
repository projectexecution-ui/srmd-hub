// The scheduled-job plan, as pure data + pure functions so it can be unit-tested
// and reasoned about away from the route. See app/api/cron/dispatch/route.ts.
//
// Robustness model (Vercel Hobby only fires 2 best-effort crons/day, and can
// skip one): every "daily" job is ATTEMPTED in BOTH the 09:00 and 15:00 IST
// slots, but a shared ledger (app_settings.cron_ledger, keyed by IST date) makes
// it RUN at most once per day. So:
//   • 09:00 runs it → ledger stamped → 15:00 skips it (no double-send).
//   • 09:00 skipped entirely → 15:00 runs it (self-heal).
//   • 09:00 attempt fails → not stamped → 15:00 retries it.
// "each"-slot jobs (retries / refreshers) intentionally run every slot.

export type Slot = 'am' | 'pm'

export interface CronJob {
  /** Stable ledger key. */
  key: string
  /** Exact path (with query) to call in the am / pm slot; omit a slot to skip it. */
  am?: string
  pm?: string
  /** 'daily' = at most once per IST day (attempted every slot it appears in);
   *  'each'  = run every slot it appears in. */
  policy: 'daily' | 'each'
  /** in4-followup wants an every-3rd-day cadence. */
  everyThirdDayOnly?: boolean
}

// Paths are byte-identical to the historical am/pm lists so behaviour per call is
// unchanged; only the RUN decision (attempt daily jobs in both slots) is new.
export const CRON_JOBS: CronJob[] = [
  // ── Daily jobs (once/IST-day, now attempted am AND pm for self-heal) ──────
  { key: 'jmr-weekly',            policy: 'daily', am: '/api/jmr/weekly-report?cron=1',        pm: '/api/jmr/weekly-report?cron=1' },
  { key: 'cc-backup',             policy: 'daily', am: '/api/cost-control/backup?cron=1',      pm: '/api/cost-control/backup?cron=1' },
  { key: 'in4-followup',          policy: 'daily', am: '/api/cost-control/in4-followup?cron=1', pm: '/api/cost-control/in4-followup?cron=1', everyThirdDayOnly: true },
  { key: 'procurement-digest',    policy: 'daily', am: '/api/cron/procurement-digest?cron=1',  pm: '/api/cron/procurement-digest?cron=1' },
  { key: 'engineer-digest',       policy: 'daily', am: '/api/cron/engineer-digest?cron=1',     pm: '/api/cron/engineer-digest?cron=1' },
  { key: 'daily-site-report',     policy: 'daily', am: '/api/cron/daily-site-report?cron=1',   pm: '/api/cron/daily-site-report?cron=1' },
  { key: 'inventory-low-stock',   policy: 'daily', am: '/api/cron/inventory-low-stock?cron=1', pm: '/api/cron/inventory-low-stock?cron=1' },
  { key: 'inventory-daily-report',policy: 'daily', am: '/api/cron/inventory-daily-report?cron=1', pm: '/api/cron/inventory-daily-report?cron=1' },
  { key: 'bills-digest',          policy: 'daily', am: '/api/cron/bills-digest?cron=1',        pm: '/api/cron/bills-digest?cron=1' },
  // cc-approval-digest is pm-only by design (an ~EOD summary); its own
  // approval_events.mgmt_digest_at guard heals a skipped pm on the next pm.
  { key: 'cc-approval-digest',    policy: 'daily',                                             pm: '/api/cron/cc-approval-digest?cron=1' },
  // ── Each-slot jobs (intentionally run at both 09:00 and 15:00) ────────────
  { key: 'bills-pipeline',        policy: 'each',  am: '/api/cron/bills-pipeline?cron=1',      pm: '/api/cron/bills-pipeline?cron=1&slot=pm' },
  { key: 'bph-sync',              policy: 'each',  am: '/api/cron/bph-sync?cron=1',            pm: '/api/cron/bph-sync?cron=1' },
  { key: 'email-retry',           policy: 'each',  am: '/api/cron/email-retry?cron=1',         pm: '/api/cron/email-retry?cron=1' },
]

/** IST calendar date (YYYY-MM-DD) for a given epoch ms — the ledger key. */
export function istDateOf(nowMs: number): string {
  return new Date(nowMs + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

/** in4-followup's every-3rd-day gate (UTC-day count; cadence is TZ-agnostic). */
export function isEveryThirdDay(nowMs: number): boolean {
  return Math.floor(nowMs / 86_400_000) % 3 === 0
}

export interface PlannedJob { key: string; path: string; policy: 'daily' | 'each' }

/** The jobs to actually call this slot: each-slot always; daily only if not
 *  already stamped for `istDate` in the ledger. */
export function plannedJobs(
  slot: Slot,
  ledger: Record<string, string>,
  istDate: string,
  everyThirdDay: boolean,
): PlannedJob[] {
  const out: PlannedJob[] = []
  for (const j of CRON_JOBS) {
    const path = slot === 'am' ? j.am : j.pm
    if (!path) continue
    if (j.everyThirdDayOnly && !everyThirdDay) continue
    if (j.policy === 'daily' && ledger[j.key] === istDate) continue // already done today
    out.push({ key: j.key, path, policy: j.policy })
  }
  return out
}

/** Fold successful daily-job results into a new ledger stamped for today. */
export function stampLedger(
  ledger: Record<string, string>,
  results: Array<{ key: string; policy: 'daily' | 'each'; ok: boolean }>,
  istDate: string,
): Record<string, string> {
  const next = { ...ledger }
  for (const r of results) {
    if (r.policy === 'daily' && r.ok) next[r.key] = istDate
  }
  return next
}

/** The legacy per-slot path lists — the fail-open fallback used only when the
 *  ledger can't be read (no service key), so behaviour then equals the old
 *  am=full / pm=subset split with no risk of double-sending daily jobs. */
export function legacyJobs(slot: Slot, everyThirdDay: boolean): string[] {
  if (slot === 'pm') {
    return ['/api/cron/bills-pipeline?cron=1&slot=pm', '/api/cron/bph-sync?cron=1', '/api/cron/email-retry?cron=1', '/api/cron/cc-approval-digest?cron=1']
  }
  return [
    '/api/jmr/weekly-report?cron=1',
    '/api/cost-control/backup?cron=1',
    ...(everyThirdDay ? ['/api/cost-control/in4-followup?cron=1'] : []),
    '/api/cron/procurement-digest?cron=1',
    '/api/cron/engineer-digest?cron=1',
    '/api/cron/email-retry?cron=1',
    '/api/cron/daily-site-report?cron=1',
    '/api/cron/inventory-low-stock?cron=1',
    '/api/cron/inventory-daily-report?cron=1',
    '/api/cron/bills-pipeline?cron=1',
    '/api/cron/bills-digest?cron=1',
    '/api/cron/bph-sync?cron=1',
  ]
}
