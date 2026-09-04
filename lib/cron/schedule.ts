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
  /** The module this job serves. When the Portal Owner switches that module
   *  off, the job is skipped — Daily Site Report was off for a month while its
   *  digest kept mailing every morning. Omit for portal-wide jobs (backup,
   *  email retry). */
  module?: string
}

// Paths are byte-identical to the historical am/pm lists so behaviour per call is
// unchanged; only the RUN decision (attempt daily jobs in both slots) is new.
export const CRON_JOBS: CronJob[] = [
  // ── Daily jobs (once/IST-day, now attempted am AND pm for self-heal) ──────
  { key: 'jmr-weekly',            policy: 'daily', module: 'jmr', am: '/api/jmr/weekly-report?cron=1',        pm: '/api/jmr/weekly-report?cron=1' },
  { key: 'cc-backup',             policy: 'daily', am: '/api/cost-control/backup?cron=1',      pm: '/api/cost-control/backup?cron=1' },
  { key: 'in4-followup',          policy: 'daily', module: 'cost-control', am: '/api/cost-control/in4-followup?cron=1', pm: '/api/cost-control/in4-followup?cron=1', everyThirdDayOnly: true },
  { key: 'procurement-digest',    policy: 'daily', module: 'procurement-tracker', am: '/api/cron/procurement-digest?cron=1',  pm: '/api/cron/procurement-digest?cron=1' },
  { key: 'engineer-digest',       policy: 'daily', module: 'cost-control', am: '/api/cron/engineer-digest?cron=1',     pm: '/api/cron/engineer-digest?cron=1' },
  { key: 'daily-site-report',     policy: 'daily', module: 'daily-site-report', am: '/api/cron/daily-site-report?cron=1',   pm: '/api/cron/daily-site-report?cron=1' },
  { key: 'inventory-low-stock',   policy: 'daily', module: 'inventory', am: '/api/cron/inventory-low-stock?cron=1', pm: '/api/cron/inventory-low-stock?cron=1' },
  { key: 'inventory-daily-report',policy: 'daily', module: 'inventory', am: '/api/cron/inventory-daily-report?cron=1', pm: '/api/cron/inventory-daily-report?cron=1' },
  { key: 'bills-digest',          policy: 'daily', module: 'bills-pipeline', am: '/api/cron/bills-digest?cron=1',        pm: '/api/cron/bills-digest?cron=1' },
  { key: 'bills-stuck-worklist',  policy: 'daily', module: 'bills-pipeline', am: '/api/cron/bills-stuck-worklist?cron=1', pm: '/api/cron/bills-stuck-worklist?cron=1' },
  // cc-approval-digest rides BOTH slots so the reliable MORNING batch always
  // sends it (the afternoon slot is best-effort on Vercel's free plan and can be
  // skipped). Its own approval_events.mgmt_digest_at guard prevents any double-send.
  { key: 'cc-approval-digest',    policy: 'daily', module: 'cost-control', am: '/api/cron/cc-approval-digest?cron=1',  pm: '/api/cron/cc-approval-digest?cron=1' },
  // Morning reminder to whoever a budget is waiting on (aged since a previous
  // day); escalates items stuck 3+ days. Rides both slots; its own IST-date
  // "aged since a previous day" gate + the ledger prevent a double-send.
  { key: 'cc-approval-reminders', policy: 'daily', module: 'cost-control', am: '/api/cron/cc-approval-reminders?cron=1', pm: '/api/cron/cc-approval-reminders?cron=1' },
  // Trustee release digest — one grouped "budgets to release" summary per founder
  // (only fires when cc_tg_trustee_digest is on). Both slots; ledger caps to once/day.
  { key: 'cc-trustee-digest',     policy: 'daily', module: 'cost-control', am: '/api/cron/cc-trustee-digest?cron=1',    pm: '/api/cron/cc-trustee-digest?cron=1' },
  // Weekly portfolio Budget-vs-Actual card to management; the route self-gates
  // to Monday IST (BPH data refreshes weekly), so most days it no-ops.
  { key: 'cc-budget-vs-actual',   policy: 'daily', module: 'cost-control', am: '/api/cron/cc-budget-vs-actual?cron=1',   pm: '/api/cron/cc-budget-vs-actual?cron=1' },
  // ── Each-slot jobs (intentionally run at both 09:00 and 15:00) ────────────
  { key: 'bills-pipeline',        policy: 'each', module: 'bills-pipeline',  am: '/api/cron/bills-pipeline?cron=1',      pm: '/api/cron/bills-pipeline?cron=1&slot=pm' },
  // IN4 live budget sync — reads IN4's SQL Server, rebuilds the SRMD Budget vs
  // Expenses report and (in live mode) replaces the weekly Excel upload. Listed
  // before bph-sync so the pull that follows sees fresh figures. Portal-wide on
  // purpose: Cost Control's ERP columns depend on it even if the BPH tile is off.
  { key: 'in4-sync',              policy: 'each',  am: '/api/cron/in4-sync?cron=1',    pm: '/api/cron/in4-sync?cron=1' },
  // The other IN4 feeds — Indent → PO tracker, Contractor and Supplier reports,
  // and the masters mirror. One job each so a slow one cannot time out another.
  { key: 'in4-tracker',           policy: 'each',  am: '/api/cron/in4-sync?cron=1&feed=tracker',    pm: '/api/cron/in4-sync?cron=1&feed=tracker' },
  { key: 'in4-contractor',        policy: 'each',  am: '/api/cron/in4-sync?cron=1&feed=contractor', pm: '/api/cron/in4-sync?cron=1&feed=contractor' },
  { key: 'in4-supplier',          policy: 'each',  am: '/api/cron/in4-sync?cron=1&feed=supplier',   pm: '/api/cron/in4-sync?cron=1&feed=supplier' },
  { key: 'in4-masters',           policy: 'each',  am: '/api/cron/in4-sync?cron=1&feed=masters',    pm: '/api/cron/in4-sync?cron=1&feed=masters' },
  { key: 'bph-sync',              policy: 'each', module: 'cost-control',  am: '/api/cron/bph-sync?cron=1',            pm: '/api/cron/bph-sync?cron=1' },
  { key: 'email-retry',           policy: 'each',  am: '/api/cron/email-retry?cron=1',         pm: '/api/cron/email-retry?cron=1' },
  // Google Drive archive — copies new uploads to the Shared drive and moves the
  // copies of deleted files under Archive/. Portal-wide; 503s until configured.
  { key: 'drive-archive',         policy: 'each',  am: '/api/cron/drive-archive?cron=1',      pm: '/api/cron/drive-archive?cron=1' },
  // am = Monday week-plan ping (route self-gates to Mondays); pm = evening open-promises reminder
  { key: 'schedule-nudge',        policy: 'each', module: 'schedule',  am: '/api/cron/schedule-nudge?cron=1',      pm: '/api/cron/schedule-nudge?cron=1&slot=pm' },
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
  /** Modules the Portal Owner has switched off (module_visibility.enabled = false). */
  disabledModules: ReadonlySet<string> = new Set(),
): PlannedJob[] {
  const out: PlannedJob[] = []
  for (const j of CRON_JOBS) {
    const path = slot === 'am' ? j.am : j.pm
    if (!path) continue
    if (j.module && disabledModules.has(j.module)) continue // module is off — its job is too
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
    '/api/cron/cc-approval-digest?cron=1',
    '/api/cron/cc-approval-reminders?cron=1',
    '/api/cron/cc-budget-vs-actual?cron=1',
    '/api/cron/bph-sync?cron=1',
  ]
}
