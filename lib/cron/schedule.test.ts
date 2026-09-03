import { describe, it, expect } from 'vitest'
import { plannedJobs, stampLedger, istDateOf, isEveryThirdDay, CRON_JOBS } from './schedule'

const DAY = '2026-08-06'

describe('istDateOf', () => {
  it('rolls to the IST calendar date (UTC late-evening is next IST day)', () => {
    // 2026-08-05 20:00 UTC = 2026-08-06 01:30 IST
    expect(istDateOf(Date.parse('2026-08-05T20:00:00Z'))).toBe('2026-08-06')
    // 2026-08-06 03:30 UTC (the am cron) = 09:00 IST same day
    expect(istDateOf(Date.parse('2026-08-06T03:30:00Z'))).toBe('2026-08-06')
  })
})

describe('plannedJobs — a switched-off module takes its jobs with it', () => {
  it('skips every job tagged with a disabled module and nothing else', () => {
    const off = new Set(['daily-site-report', 'inventory'])
    const keys = plannedJobs('am', {}, DAY, false, off).map(j => j.key)
    expect(keys).not.toContain('daily-site-report')
    expect(keys).not.toContain('inventory-low-stock')
    expect(keys).not.toContain('inventory-daily-report')
    expect(keys).toContain('cc-backup')       // portal-wide, no module
    expect(keys).toContain('procurement-digest')
  })
  it('every job that mails a module owner names its module', () => {
    const untagged = CRON_JOBS.filter(j => !j.module).map(j => j.key)
    expect(untagged.sort()).toEqual(['cc-backup', 'email-retry'])
  })
})

describe('plannedJobs — daily jobs run once/day across both slots', () => {
  it('am with an empty ledger runs every am daily + each job', () => {
    const jobs = plannedJobs('am', {}, DAY, false)
    const keys = jobs.map(j => j.key)
    expect(keys).toContain('procurement-digest')
    expect(keys).toContain('engineer-digest')
    expect(keys).toContain('bph-sync')      // each-slot
    expect(keys).not.toContain('in4-followup') // not an every-3rd day
    expect(keys).toContain('cc-approval-digest') // rides the reliable morning batch now
  })

  it('pm SKIPS daily jobs already stamped for today, but re-runs each-slot jobs', () => {
    const ledger = { 'procurement-digest': DAY, 'engineer-digest': DAY }
    const jobs = plannedJobs('pm', ledger, DAY, false)
    const keys = jobs.map(j => j.key)
    expect(keys).not.toContain('procurement-digest') // done at am
    expect(keys).not.toContain('engineer-digest')
    expect(keys).toContain('bph-sync')               // each-slot always
    expect(keys).toContain('email-retry')
    expect(keys).toContain('cc-approval-digest')      // daily, not yet stamped → pm still attempts it
  })

  it('pm RE-RUNS a daily job that was NOT stamped (am was skipped) — self-heal', () => {
    const jobs = plannedJobs('pm', {}, DAY, false) // nothing ran at am
    const keys = jobs.map(j => j.key)
    expect(keys).toContain('procurement-digest')     // caught up in pm
    expect(keys).toContain('inventory-daily-report')
  })

  it('a stale ledger (yesterday) does not block today', () => {
    const jobs = plannedJobs('am', { 'procurement-digest': '2026-08-05' }, DAY, false)
    expect(jobs.map(j => j.key)).toContain('procurement-digest')
  })

  it('in4-followup only appears on an every-3rd day', () => {
    expect(plannedJobs('am', {}, DAY, true).map(j => j.key)).toContain('in4-followup')
    expect(plannedJobs('am', {}, DAY, false).map(j => j.key)).not.toContain('in4-followup')
  })
})

describe('stampLedger', () => {
  it('stamps only daily jobs that succeeded; leaves each-slot + failures alone', () => {
    const next = stampLedger({}, [
      { key: 'procurement-digest', policy: 'daily', ok: true },
      { key: 'engineer-digest', policy: 'daily', ok: false },  // failed → retry next slot
      { key: 'bph-sync', policy: 'each', ok: true },           // each-slot → never stamped
    ], DAY)
    expect(next['procurement-digest']).toBe(DAY)
    expect(next['engineer-digest']).toBeUndefined()
    expect(next['bph-sync']).toBeUndefined()
  })
})

describe('registry sanity', () => {
  it('every job defines at least one slot and a policy', () => {
    for (const j of CRON_JOBS) {
      expect(j.am || j.pm).toBeTruthy()
      expect(['daily', 'each']).toContain(j.policy)
    }
  })
  it('isEveryThirdDay repeats every 3 days (exactly one in any 3 consecutive)', () => {
    const base = Date.parse('2026-08-06T00:00:00Z')
    const window = [0, 1, 2].map(d => isEveryThirdDay(base + d * 86_400_000))
    expect(window.filter(Boolean).length).toBe(1)
    for (let d = 0; d < 3; d++) {
      expect(isEveryThirdDay(base + (d + 3) * 86_400_000)).toBe(isEveryThirdDay(base + d * 86_400_000))
    }
  })
})
