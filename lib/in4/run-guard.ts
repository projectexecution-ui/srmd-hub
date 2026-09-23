// Guard rails for the IN4 sync runs — what keeps a slow run from leaving a
// lie behind.
//
// A Vercel function that reaches maxDuration is killed where it stands: no
// catch block runs, so the in4_sync_runs row it opened stays ok = null with no
// finished_at, and the status chip keeps showing the previous run's result as
// if nothing had happened. That is what the budget feed did at 21 Sep 15:41,
// 22 Sep 09:21 and 22 Sep 15:41 (2026). In the same slots the tracker feed's
// ~0.9 MB state write hit Postgres' statement timeout — the service role
// inherits the authenticator's 8 s (Supabase default) — with ~20 cron jobs
// landing on the same small instance at once.
//
// Three small rules, shared by every feed:
//   • deadline — a run budgets its own time, well inside maxDuration, and
//     stops with a RECORDED error instead of being stopped silently;
//   • retry   — a big write that hits the statement timeout is tried again
//     after a pause, while the deadline allows;
//   • sweep   — before a feed starts, any earlier row it left open is closed
//     as failed, with a message that says why.
//
// Pure where it can be (tested in ./run-guard.test.ts); the sweep is the only
// part that touches the database.

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDateTime } from '@/lib/utils'

/** The in4-sync route's maxDuration is 120 s. Leave room after this for the
 *  bookkeeping writes (run row, status pointer) and the response. */
export const RUN_BUDGET_MS = 100_000

/** A run row still open this long after it started was killed, not slow:
 *  no feed can run longer than maxDuration (120 s). */
export const ORPHAN_AFTER_MS = 10 * 60_000

export interface Deadline { at: number; budgetMs: number }

export function makeDeadline(startMs = Date.now(), budgetMs = RUN_BUDGET_MS): Deadline {
  return { at: startMs + budgetMs, budgetMs }
}

export function timeLeft(d: Deadline, now = Date.now()): number {
  return d.at - now
}

export class OutOfTimeError extends Error {
  constructor(step: string, d: Deadline) {
    super(`Ran out of time before ${step}: the run's ${Math.round(d.budgetMs / 1000)} s budget was used up, so it stopped here rather than be cut off mid-write by the function limit. The next run picks up from the same place.`)
    this.name = 'OutOfTimeError'
  }
}

/** Throw a recorded, explained error instead of letting maxDuration kill the run. */
export function assertTimeLeft(d: Deadline, step: string, now = Date.now()): void {
  if (timeLeft(d, now) <= 0) throw new OutOfTimeError(step, d)
}

// ── retry ────────────────────────────────────────────────────────────────────

/** Pauses before the 2nd and 3rd attempt. Long enough for the other cron
 *  jobs' bulk upserts to clear, short enough to fit the run budget. */
export const RETRY_DELAYS_MS = [3_000, 8_000]

/** What is worth a second try: the statement timeout itself, a lock the
 *  other transaction will release, or the network dropping the request.
 *  A constraint violation or a bad column is not — it would fail again. */
export function isRetryable(message: string): boolean {
  return /statement timeout|canceling statement|lock timeout|deadlock detected|could not serialize|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|\b50[234]\b/i.test(message)
}

export interface RetryResult { ok: boolean; attempts: number; error: string | null }

export interface RetryOptions {
  deadline?: Deadline
  delays?: number[]
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Room a retry needs after its pause to actually do the write. */
  minRunwayMs?: number
}

/** Run `attempt` (which resolves to an error message, or null on success) up
 *  to delays.length + 1 times. Stops early on a non-retryable error, or when
 *  the deadline would not leave room for another go. */
export async function withRetry(attempt: () => Promise<string | null>, opts: RetryOptions = {}): Promise<RetryResult> {
  const delays = opts.delays ?? RETRY_DELAYS_MS
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const now = opts.now ?? Date.now
  const runway = opts.minRunwayMs ?? 5_000
  let attempts = 0
  let error: string | null = null
  for (;;) {
    attempts += 1
    error = await attempt()
    if (error === null) return { ok: true, attempts, error: null }
    const delay = delays[attempts - 1]
    if (delay === undefined || !isRetryable(error)) return { ok: false, attempts, error }
    if (opts.deadline && timeLeft(opts.deadline, now()) < delay + runway) return { ok: false, attempts, error }
    await sleep(delay)
  }
}

/** "canceling statement due to statement timeout (after 3 attempts)" — the
 *  attempt count is the difference between a one-off and a wall. */
export function describeFailure(label: string, r: RetryResult): string {
  return `${label}: ${r.error ?? 'failed'}${r.attempts > 1 ? ` (after ${r.attempts} attempts)` : ''}`
}

// ── sweep ────────────────────────────────────────────────────────────────────

export function orphanCutoff(nowMs: number, afterMs = ORPHAN_AFTER_MS): string {
  return new Date(nowMs - afterMs).toISOString()
}

export function orphanError(closedAtIso: string): string {
  return `Did not finish: the function was stopped before it could record a result (Vercel's time limit, or the process died mid-run), so nothing it was writing at that moment landed. Closed as failed by the next run at ${formatDateTime(closedAtIso)} IST.`
}

/** Close every run row of `feed` that is still open long after it started.
 *  Best effort — a failure here must never stop the run that called it. */
export async function closeOrphanRuns(sb: Pick<SupabaseClient, 'from'>, feed: string, nowMs = Date.now()): Promise<number> {
  try {
    const closedAt = new Date(nowMs).toISOString()
    const { data, error } = await sb
      .from('in4_sync_runs')
      .update({ ok: false, finished_at: closedAt, error: orphanError(closedAt) })
      .eq('feed', feed)
      .is('finished_at', null)
      .lt('started_at', orphanCutoff(nowMs))
      .select('id')
    if (error) { console.warn(`[in4-${feed}] could not close orphaned runs:`, error.message); return 0 }
    return data?.length ?? 0
  } catch (e) {
    console.warn(`[in4-${feed}] could not close orphaned runs:`, e instanceof Error ? e.message : e)
    return 0
  }
}
