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
  let sawRetryable = false
  for (let i = 0; i < attempts; i++) {
    const { data, error } = await supabase.auth.getUser()
    if (!error) return { user: data?.user ?? null, unavailable: false }

    sawRetryable = isRetryable(error)
    // A definite "no" — expired or invalid token. Answer immediately.
    if (!sawRetryable) return { user: null, unavailable: false }

    if (i < attempts - 1) await new Promise(r => setTimeout(r, 120 * (i + 1)))
  }
  return { user: null, unavailable: sawRetryable }
}
