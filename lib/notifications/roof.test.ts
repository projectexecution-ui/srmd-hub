import { describe, it, expect } from 'vitest'
import { resolveRoof } from './roof'

// The REAL values, read out of the live database on 2026-09-02. The point of
// pinning them here is that the warnings this screen shows are checkable, not
// a claim — if a number in the answer is wrong, this test is wrong too.
const SETTINGS = new Map<string, string>([
  ['bills_digest_enabled', 'true'],
  ['bills_digest_assignments', '{"465e6bfe-b348-48d6-9346-836b0d444ec7":["NGH","P2","VV"],"4d76ff25-097e-475a-b6cd-3ccf709261d8":["NGH","P2","VV"]}'],
  ['bills_worklist_to', 'mayank.srmd@gmail.com'],
  ['jmr_weekly_report_recipients', '[]'],
  ['procurement_notify_enabled', 'true'],
  ['procurement_notify_assignments', '{"465e6bfe-b348-48d6-9346-836b0d444ec7":["New Guest House","P2 Infra"],"4d76ff25-097e-475a-b6cd-3ccf709261d8":["Vinay Vivek"]}'],
  // inv_daily_report_emails and inv_low_stock_alerts do not exist at all.
])

const RULES = [
  ...['email', 'in_app'].map(channel => ({ event_type: 'daily_site_report_digest', channel, enabled: false })),
  ...['email', 'in_app'].map(channel => ({ event_type: 'inv_site_stock_reminder', channel, enabled: false })),
  ...['email', 'web_push'].map(channel => ({ event_type: 'email_health', channel, enabled: false })),
  { event_type: 'jmr_entry_submitted', channel: 'email', enabled: false },
  { event_type: 'sched_promise_nudge', channel: 'email', enabled: false },
  // Every warehouse event is off on every channel.
  ...['wh_request_raised', 'wh_request_decided', 'wh_request_to_issue', 'wh_request_issued', 'wh_return_waived']
    .flatMap(event_type => ['email', 'in_app', 'web_push'].map(channel => ({ event_type, channel, enabled: false }))),
  // On.
  ...['email', 'in_app'].map(channel => ({ event_type: 'procurement_digest', channel, enabled: true })),
  ...['email', 'in_app'].map(channel => ({ event_type: 'access_request', channel, enabled: true })),
]

const NAMES = new Map([
  ['465e6bfe-b348-48d6-9346-836b0d444ec7', 'Akshay Atmarpit'],
  ['4d76ff25-097e-475a-b6cd-3ccf709261d8', 'Amit Gala'],
])

const roof = () => resolveRoof({ settings: SETTINGS, rules: RULES, names: NAMES })
const row = (key: string) => roof().rows.find(r => r.message.key === key)!

describe('what the roof reports about the live setup', () => {
  it('resolves an assignment map into named people with their project counts', () => {
    expect(row('bills_digest').recipients).toEqual([
      'Akshay Atmarpit · 3 projects',
      'Amit Gala · 3 projects',
    ])
    expect(row('bills_digest').warning).toBeUndefined()
  })

  it('reads a bare address rather than choking on non-JSON', () => {
    expect(row('bills_stuck_worklist').recipients).toEqual(['mayank.srmd@gmail.com'])
  })

  it('counts differing project lists per person', () => {
    expect(row('procurement_digest').recipients).toEqual([
      'Akshay Atmarpit · 2 projects',
      'Amit Gala · 1 project',
    ])
  })

  // The findings the screen exists to surface.
  it('flags the JMR weekly report as reaching nobody — its list is empty', () => {
    const r = row('jmr_weekly_report')
    expect(r.recipients).toEqual([])
    expect(r.warning).toMatch(/reaches nobody/i)
  })

  it('flags the inventory reports — their settings keys do not exist at all', () => {
    expect(row('inventory_daily_report').warning).toMatch(/reaches nobody/i)
    expect(row('inv_site_stock_reminder').warning).toBeTruthy()
  })

  it('flags every warehouse alert as delivering nothing — all channels are off', () => {
    for (const key of ['wh_request_raised', 'wh_request_decided', 'wh_request_to_issue', 'wh_request_issued', 'wh_return_waived']) {
      const r = row(key)
      expect(r.channelsOn, key).toEqual([])
      expect(r.warning, key).toMatch(/every channel is switched off/i)
    }
  })

  it('does not flag a message that still has one channel on', () => {
    const r = row('jmr_entry_submitted')
    expect(r.channelsOn).toEqual(['in_app', 'web_push'])
    expect(r.warning).toBeUndefined()
  })

  // A missing rule row means ON — treating absence as "off" would paint most of
  // the list red and make the warnings worthless.
  it('treats a message with no rule rows as fully on', () => {
    const r = row('comment_mention')
    expect(r.channelsOn).toEqual(['in_app', 'email', 'web_push'])
    expect(r.warning).toBeUndefined()
  })

  it('reports no channels for messages that bypass the switches', () => {
    expect(row('bills_stuck_worklist').channelsOn).toEqual([])
    expect(row('bills_stuck_worklist').warning).toBeUndefined() // it has a real address
  })

  it('totals the problems', () => {
    const { silent, ignoring } = roof()
    expect(ignoring).toBe(3)
    expect(silent).toBeGreaterThanOrEqual(8) // 5 warehouse + JMR + 2 inventory
  })
})
