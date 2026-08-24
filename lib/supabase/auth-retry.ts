/** Resilient wrapper around supabase.auth.getUser().
 *
 *  Written during a live Supabase incident (status.supabase.com, "401 errors due
 *  to JWT rejections", open since 21 Aug) in which Vercel's functions saw
 *  intermittent 504s from Auth:
 *
 *      Error [AuthRetryableFetchError] __isAuthError: true status: 504
 *
 *  Two separate faults made that log every user out:
 *
 *  1. Both page-load call sites destructured only `data` and threw the `error`
 *     away, so a timeout produced `user = null` — indistinguishable from
 *     "signed out". The proxy then redirected to /login, so signed-in people
 *     were thrown back to the login screen mid-task.
 *  2. Nothing retried, even though the SDK names the error *Retryable*.
 *
 *  `unavailable` is the distinction that was missing: "we never got a definite
 *  answer" is not the same fact as "there is no user", and callers must not
 *  treat it as a logout.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type AuthOutcome = {
  user: any | null
  /** True when auth never answered. NOT a logout — do not redirect on this. */
  unavailable: boolean
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

/** Vercel kills Routing Middleware at 25 s. During the incident a single
 *  getUser() hung for ~25 s on its own, so retrying it without a clock turned
 *  an intermittent redirect-to-login into a hard 504 MIDDLEWARE_INVOCATION_
 *  TIMEOUT — strictly worse. These caps keep the whole attempt an order of
 *  magnitude inside the platform limit; giving up fast and letting the page
 *  decide beats holding the request until Vercel kills it. */
const PER_ATTEMPT_MS = 1500
const TOTAL_BUDGET_MS = 3500

/** Resolve with a marker instead of waiting forever. The underlying request may
 *  still be in flight; we simply stop being blocked by it. */
const TIMED_OUT = Symbol('timed-out')
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(TIMED_OUT), ms)
    p.then(v => { clearTimeout(t); resolve(v) }, () => { clearTimeout(t); resolve(TIMED_OUT) })
  })
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; status?: number; message?: string }
  if (e.name === 'AuthRetryableFetchError') return true
  if (typeof e.status === 'number' && RETRYABLE_STATUS.has(e.status)) return true
  return /fetch failed|network|timeout|ETIMEDOUT|ECONNRESET|socket hang up/i.test(e.message ?? '')
}

/** Ask auth who this is, retrying only faults that are actually transient.
 *
 *  A wrong or expired token fails fast (not retryable) so a real sign-out is
 *  still instant. Worst case for a genuine outage is ~360 ms of backoff across
 *  three attempts, which is far cheaper than throwing the user out. */
export async function getUserResilient(supabase: any, attempts = 3): Promise<AuthOutcome> {
  const deadline = Date.now() + TOTAL_BUDGET_MS
  let sawRetryable = false

  for (let i = 0; i < attempts; i++) {
    const left = deadline - Date.now()
    if (left <= 0) return { user: null, unavailable: true }

    const res = await withTimeout(
      supabase.auth.getUser(),
      Math.min(PER_ATTEMPT_MS, left),
    )

    // Hung past its slice. Treat as transient and keep the clock running.
    if (res === TIMED_OUT) { sawRetryable = true; continue }

    const { data, error } = res as { data?: any; error?: unknown }
    if (!error) return { user: data?.user ?? null, unavailable: false }

    sawRetryable = isRetryable(error)
    // A definite "no" — expired or invalid token. Answer immediately.
    if (!sawRetryable) return { user: null, unavailable: false }

    if (i < attempts - 1 && deadline - Date.now() > 200) {
      await new Promise(r => setTimeout(r, 120 * (i + 1)))
    }
  }
  return { user: null, unavailable: sawRetryable }
}
