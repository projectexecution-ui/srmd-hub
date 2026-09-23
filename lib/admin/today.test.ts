import { describe, it, expect } from 'vitest'
import { todayRows, UNFINISHED_AFTER_MS, type TodayInput } from './today'

const NOW = Date.parse('2026-09-23T06:00:00Z') // 11:30 IST
const base: TodayInput = { nowMs: NOW, pendingAccess: 0, pendingDeletes: 0, feeds: [], ledger: { 'cc-backup': '2026-09-23' }, findings: [] }

describe('todayRows', () => {
  it('a quiet morning is an empty strip', () => {
    expect(todayRows(base)).toEqual([])
  })

  it('the 22 Sep tracker failure reads as one red line pointing at IN4, with the error', () => {
    const rows = todayRows({ ...base, feeds: [
      { feed: 'tracker', label: 'Indent → PO tracker', startedAt: '2026-09-22T11:43:16Z', ok: false, error: 'procurement_tracker_state(global): canceling statement due to statement timeout' },
    ] })
    expect(rows).toHaveLength(1)
    expect(rows[0].tone).toBe('bad')
    expect(rows[0].href).toBe('/admin/data?tab=in4')
    expect(rows[0].text).toMatch(/^The Indent → PO tracker feed failed at .* — procurement_tracker_state\(global\): canceling statement due to statement timeout\.$/)
  })

  it('a run with no result is "never finished" only once it is old enough', () => {
    const fresh = todayRows({ ...base, feeds: [{ feed: 'budget', label: 'Budget', startedAt: new Date(NOW - 5 * 60_000).toISOString(), ok: null, error: null }] })
    expect(fresh).toEqual([])
    const stuck = todayRows({ ...base, feeds: [{ feed: 'budget', label: 'Budget', startedAt: new Date(NOW - UNFINISHED_AFTER_MS - 1000).toISOString(), ok: null, error: null }] })
    expect(stuck[0].text).toMatch(/started at .* and never finished\.$/)
    expect(stuck[0].tone).toBe('warn')
  })

  it('the stale ledger of 15 Sep is named, with the consequence', () => {
    const rows = todayRows({ ...base, ledger: { 'cc-backup': '2026-09-15', 'bills-digest': '2026-09-15' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('The scheduled-jobs record was last saved on 15 Sept — jobs are running unrecorded, so a daily digest can go out twice.')
    expect(rows[0].href).toBe('/admin/messages?tab=health')
  })

  it('no ledger at all is an info line, not a red one', () => {
    expect(todayRows({ ...base, ledger: null })[0]).toMatchObject({ tone: 'info', id: 'ledger' })
  })

  it('queues and health findings join, red first, and old fix links move to their door', () => {
    const rows = todayRows({
      ...base, pendingAccess: 2, pendingDeletes: 1,
      findings: [
        { id: 'silent-messages', severity: 'blocker', title: '2 alerts reach nobody', detail: 'Switched on but delivering nothing.', href: '/admin/reports', fixLabel: 'See which' },
        { id: 'unused-roles', severity: 'info', title: '3 roles are set up but nobody holds them', detail: 'x', href: '/admin/permissions', fixLabel: 'Review roles' },
      ],
    })
    expect(rows.map(r => r.tone)).toEqual(['bad', 'warn', 'warn', 'info'])
    expect(rows[0].href).toBe('/admin/messages?tab=scheduled')
    expect(rows[3].href).toBe('/admin/people?tab=roles')
    expect(rows.find(r => r.id === 'access')?.text).toBe('2 people are waiting for access to the hub.')
    expect(rows.find(r => r.id === 'deletes')?.href).toBe('/admin/data?tab=deleted')
  })
})
