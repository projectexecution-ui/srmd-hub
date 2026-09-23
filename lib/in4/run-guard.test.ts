import { describe, it, expect, vi } from 'vitest'
import {
  makeDeadline, timeLeft, assertTimeLeft, OutOfTimeError,
  withRetry, isRetryable, describeFailure, orphanCutoff, orphanError, closeOrphanRuns, ORPHAN_AFTER_MS,
} from './run-guard'

const T0 = Date.parse('2026-09-23T04:00:00Z')

describe('deadline', () => {
  it('counts down from the start and throws a recorded, explained error once spent', () => {
    const d = makeDeadline(T0, 100_000)
    expect(timeLeft(d, T0 + 40_000)).toBe(60_000)
    expect(() => assertTimeLeft(d, 'writing the tracker state', T0 + 99_999)).not.toThrow()
    expect(() => assertTimeLeft(d, 'writing the tracker state', T0 + 100_000)).toThrow(OutOfTimeError)
    try { assertTimeLeft(d, 'writing the tracker state', T0 + 100_001) } catch (e) {
      expect((e as Error).message).toContain('Ran out of time before writing the tracker state')
      expect((e as Error).message).toContain('100 s budget')
    }
  })
})

describe('withRetry', () => {
  const noSleep = async (_ms: number) => {}

  it('returns on first success without sleeping', async () => {
    const sleep = vi.fn(noSleep)
    const r = await withRetry(async () => null, { sleep })
    expect(r).toEqual({ ok: true, attempts: 1, error: null })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries a statement timeout with the growing pauses, then succeeds', async () => {
    const sleep = vi.fn(noSleep)
    let n = 0
    const r = await withRetry(async () => (++n < 3 ? 'canceling statement due to statement timeout' : null), { sleep })
    expect(r).toEqual({ ok: true, attempts: 3, error: null })
    expect(sleep.mock.calls.map(c => c[0])).toEqual([3_000, 8_000])
  })

  it('gives up after the last pause and reports the attempt count', async () => {
    const r = await withRetry(async () => 'canceling statement due to statement timeout', { sleep: noSleep })
    expect(r.ok).toBe(false)
    expect(r.attempts).toBe(3)
    expect(describeFailure('procurement_tracker_state(global)', r))
      .toBe('procurement_tracker_state(global): canceling statement due to statement timeout (after 3 attempts)')
  })

  it('does not retry an error that would fail the same way again', async () => {
    const sleep = vi.fn(noSleep)
    const r = await withRetry(async () => 'null value in column "state" violates not-null constraint', { sleep })
    expect(r).toEqual({ ok: false, attempts: 1, error: 'null value in column "state" violates not-null constraint' })
    expect(sleep).not.toHaveBeenCalled()
  })

  it('stops retrying when the deadline would not leave room for the write', async () => {
    const sleep = vi.fn(noSleep)
    const d = makeDeadline(T0, 100_000)
    // 6 s left: the 3 s pause + 5 s runway does not fit.
    const r = await withRetry(async () => 'statement timeout', { sleep, deadline: d, now: () => T0 + 94_000 })
    expect(r.ok).toBe(false); expect(r.attempts).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('knows a timeout, a lock and a dropped connection from a real mistake', () => {
    expect(isRetryable('canceling statement due to statement timeout')).toBe(true)
    expect(isRetryable('deadlock detected')).toBe(true)
    expect(isRetryable('TypeError: fetch failed')).toBe(true)
    expect(isRetryable('duplicate key value violates unique constraint')).toBe(false)
    expect(isRetryable('column "foo" does not exist')).toBe(false)
  })
})

describe('orphan sweep', () => {
  it('only rows older than the function could possibly have run are orphans', () => {
    expect(orphanCutoff(T0)).toBe(new Date(T0 - ORPHAN_AFTER_MS).toISOString())
    expect(ORPHAN_AFTER_MS).toBeGreaterThan(120_000) // > the route's maxDuration
  })

  it('says why the row is being closed, in IST', () => {
    const msg = orphanError('2026-09-23T04:00:00Z')
    expect(msg).toMatch(/^Did not finish/)
    expect(msg).toContain('09:30') // 04:00 UTC = 09:30 IST
    expect(msg).toContain('IST')
  })

  it('updates only the feed’s own open rows and counts them', async () => {
    const calls: Record<string, unknown[]> = {}
    const chain = {
      update: (patch: unknown) => { calls.update = [patch]; return chain },
      eq: (c: string, v: unknown) => { calls.eq = [c, v]; return chain },
      is: (c: string, v: unknown) => { calls.is = [c, v]; return chain },
      lt: (c: string, v: unknown) => { calls.lt = [c, v]; return chain },
      select: async () => ({ data: [{ id: 1 }, { id: 2 }], error: null }),
    }
    const sb = { from: (t: string) => { calls.from = [t]; return chain } }
    const n = await closeOrphanRuns(sb as never, 'budget', T0)
    expect(n).toBe(2)
    expect(calls.from).toEqual(['in4_sync_runs'])
    expect(calls.eq).toEqual(['feed', 'budget'])
    expect(calls.is).toEqual(['finished_at', null])
    expect(calls.lt).toEqual(['started_at', orphanCutoff(T0)])
    const patch = calls.update[0] as { ok: boolean; error: string; finished_at: string }
    expect(patch.ok).toBe(false)
    expect(patch.finished_at).toBe(new Date(T0).toISOString())
    expect(patch.error).toMatch(/^Did not finish/)
  })

  it('never throws — a sweep failure must not stop the run', async () => {
    const sb = { from: () => { throw new Error('boom') } }
    await expect(closeOrphanRuns(sb as never, 'tracker', T0)).resolves.toBe(0)
  })
})
