import { describe, expect, it, vi } from 'vitest'
import { getUserResilient } from './auth-retry'

const client = (responses: Array<{ data?: unknown; error?: unknown }>) => {
  let i = 0
  const calls = () => i
  return {
    auth: { getUser: vi.fn(async () => responses[Math.min(i++, responses.length - 1)] as never) },
    calls,
  }
}
const ok = (id: string) => ({ data: { user: { id } }, error: null })
const noUser = { data: { user: null }, error: null }
/** The real error the incident produced. */
const timeout504 = { data: { user: null }, error: { name: 'AuthRetryableFetchError', status: 504 } }
const expired = { data: { user: null }, error: { name: 'AuthApiError', status: 401, message: 'invalid JWT' } }

describe('getUserResilient', () => {
  it('returns the user on a clean first call, with no extra requests', async () => {
    const c = client([ok('u1')])
    const r = await getUserResilient(c)
    expect(r).toEqual({ user: { id: 'u1' }, unavailable: false })
    expect(c.calls()).toBe(1)
  })

  it('THE INCIDENT: recovers when a 504 is followed by success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const c = client([timeout504, ok('u2')])
    const r = await getUserResilient(c)
    expect(r.user).toEqual({ id: 'u2' })
    expect(r.unavailable).toBe(false)   // nobody gets logged out
    expect(c.calls()).toBe(2)
    vi.useRealTimers()
  })

  it('reports unavailable — NOT logged out — when every attempt times out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const c = client([timeout504])
    const r = await getUserResilient(c)
    expect(r.user).toBeNull()
    // This is the flag the proxy checks so it does not redirect to /login.
    expect(r.unavailable).toBe(true)
    expect(c.calls()).toBe(3)
    vi.useRealTimers()
  })

  it('a genuinely expired token fails FAST and is not retried', async () => {
    const c = client([expired])
    const r = await getUserResilient(c)
    expect(r.user).toBeNull()
    expect(r.unavailable).toBe(false)   // a real sign-out stays instant
    expect(c.calls()).toBe(1)
  })

  it('an anonymous visitor is answered immediately, never retried', async () => {
    const c = client([noUser])
    const r = await getUserResilient(c)
    expect(r).toEqual({ user: null, unavailable: false })
    expect(c.calls()).toBe(1)
  })

  it('treats a bare network failure as transient', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const c = client([{ data: { user: null }, error: { message: 'fetch failed' } }, ok('u3')])
    expect((await getUserResilient(c)).user).toEqual({ id: 'u3' })
    vi.useRealTimers()
  })

  it('does not retry a 400 — that is a real rejection, not a blip', async () => {
    const c = client([{ data: { user: null }, error: { name: 'AuthApiError', status: 400 } }])
    const r = await getUserResilient(c)
    expect(r.unavailable).toBe(false)
    expect(c.calls()).toBe(1)
  })
})

/** The regression that mattered most: my first version of this retry had no
 *  clock. During the incident each getUser() hung ~25 s, so three attempts
 *  could hold the proxy for 75 s — and Vercel kills Routing Middleware at 25 s.
 *  Aksha got a hard "504 MIDDLEWARE_INVOCATION_TIMEOUT" page, which is strictly
 *  worse than the redirect-to-login it replaced. */
describe('time budget — must never hold the proxy long enough to be killed', () => {
  const hangs = (ms: number) => ({
    auth: { getUser: () => new Promise(r => setTimeout(() => r({ data: { user: null }, error: null }), ms)) },
  })

  it('gives up in a few seconds when every call hangs, not tens of seconds', async () => {
    const t0 = Date.now()
    const r = await getUserResilient(hangs(30_000))     // the real incident behaviour
    const elapsed = Date.now() - t0
    expect(r.unavailable).toBe(true)                    // reported as an outage
    expect(r.user).toBeNull()
    expect(elapsed).toBeLessThan(5_000)                 // Vercel's limit is 25 s
  }, 20_000)

  it('still returns a slow-but-successful answer rather than discarding it', async () => {
    const r = await getUserResilient({
      auth: { getUser: () => new Promise(res => setTimeout(() => res({ data: { user: { id: 'slow' } }, error: null }), 400)) },
    })
    expect(r.user).toEqual({ id: 'slow' })
    expect(r.unavailable).toBe(false)
  }, 20_000)
})
