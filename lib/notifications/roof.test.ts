import { describe, it, expect } from 'vitest'
import { resolveRoof } from './roof'

// The REAL values, read out of the live database on 2026-09-02. The point of
// pinning them here is that the warnings this screen shows are checkable, not
// a claim — if a number in the answer is wrong, this test is wrong too.
const SETTINGS = new Map<string, string>([
  ['bills_digest_enabled', 'true'],
  ['bills_digest_assignments', '{"465e6bfe-b348-48d6-9346-836b0d444ec7":["NGH","P2","VV"],"4d76ff25-097e-475a-b6cd-3ccf709261d8":["NGH","P2","VV"]}'],
  ['bills_worklist_to', 'mayank.srmd@gmail.com'],
])

const RULES = [
  ...['email', 'web_push'].map(channel => ({ event_type: 'email_health', channel, enabled: false })),
  // cc_ws_returned is off on e-mail only — one channel left, so not "silent".
  { event_type: 'cc_ws_returned', channel: 'email', enabled: false },
  // On.
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

  it('does not flag a message that still has one channel on', () => {
    const r = row('cc_ws_returned')
    expect(r.channelsOn).toEqual(['in_app', 'web_push', 'telegram'])
    expect(r.warning).toBeUndefined()
  })

  // A missing rule row means ON — treating absence as "off" would paint most of
  // the list red and make the warnings worthless.
  it('treats a message with no rule rows as fully on', () => {
    const r = row('comment_mention')
    expect(r.channelsOn).toEqual(['in_app', 'email', 'web_push', 'telegram'])
    expect(r.warning).toBeUndefined()
  })

  it('reports no channels for messages that bypass the switches', () => {
    expect(row('bills_stuck_worklist').channelsOn).toEqual([])
    expect(row('bills_stuck_worklist').warning).toBeUndefined() // it has a real address
  })

  it('totals the problems', () => {
    const { silent, ignoring } = roof()
    expect(ignoring).toBe(1)               // the stuck-bills list, sent to a plain address
    expect(silent).toBe(0)                   // nothing left that is switched off on every channel
  })
})
