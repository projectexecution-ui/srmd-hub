import { describe, it, expect } from 'vitest'
import {
  OUTBOUND, SCHEDULED_MESSAGES, INSTANT_MESSAGES,
  byModule, recipientSettingKeys, ignoresTheSwitches, spread,
} from './catalog'
import { NOTIFICATION_EVENTS } from '@/lib/notification-events'

describe('the one roof', () => {
  it('has no duplicate keys', () => {
    const keys = OUTBOUND.map(o => o.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  // The whole point: nothing the hub sends may be missing from this list, or
  // the roof leaks and "who gets what" is still a hunt through four screens.
  it('covers every registered notification event', () => {
    const covered = new Set(OUTBOUND.map(o => o.key))
    for (const e of NOTIFICATION_EVENTS) expect(covered.has(e.type), e.type).toBe(true)
  })

  it('does not list an event twice as both instant and scheduled', () => {
    const scheduled = new Set(SCHEDULED_MESSAGES.map(m => m.key))
    for (const m of INSTANT_MESSAGES) expect(scheduled.has(m.key), m.key).toBe(false)
  })

  it('gives every message a trigger a person can read', () => {
    for (const o of OUTBOUND) {
      expect(o.trigger.length, o.key).toBeGreaterThan(20)
      expect(o.label.length, o.key).toBeGreaterThan(3)
    }
  })

  it('gives every message at least one channel', () => {
    for (const o of OUTBOUND) expect(o.channels.length, o.key).toBeGreaterThan(0)
  })

  it('points every message at a real settings screen', () => {
    for (const o of OUTBOUND) expect(o.settingsHref.startsWith('/'), o.key).toBe(true)
  })

  it('names the app_settings key whenever recipients are stored in one', () => {
    for (const o of OUTBOUND) {
      if (o.recipients.kind === 'addresses' || o.recipients.kind === 'assignment') {
        expect(o.recipients.settingKey, o.key).toMatch(/^[a-z0-9_]+$/)
      }
    }
  })

  it('says who gets it, for every single one', () => {
    for (const o of OUTBOUND) expect(o.recipients.who.length, o.key).toBeGreaterThan(3)
  })

  it('gives every scheduled message a schedule, and no instant one', () => {
    for (const m of SCHEDULED_MESSAGES) expect(m.schedule, m.key).toBeTruthy()
    for (const m of INSTANT_MESSAGES) expect(m.schedule, m.key).toBeUndefined()
  })

  // These four send straight to an address list, so switching the event off on
  // /admin/notifications does nothing. That is a trap, and the roof must show
  // it rather than let an admin believe they have turned something off.
  it('flags the messages that ignore the on/off switches', () => {
    const keys = ignoresTheSwitches().map(o => o.key).sort()
    expect(keys).toEqual([
      'bills_stuck_worklist',
      'inventory_daily_report',
      'jmr_weekly_report',
    ])
  })

  it('collects every setting key the roof must read', () => {
    const keys = recipientSettingKeys()
    expect(keys).toContain('bills_worklist_to')
    expect(keys).toContain('bills_digest_assignments')
    expect(keys).toContain('procurement_notify_assignments')
    expect(keys).toContain('jmr_weekly_report_recipients')
    expect(keys).toContain('inv_daily_report_emails')
    // on/off keys come along too, so the roof can show what is switched off
    expect(keys).toContain('bills_digest_enabled')
    expect(keys).toContain('procurement_notify_enabled')
  })

  it('groups by module without losing anything', () => {
    const total = byModule().reduce((s, g) => s + g.messages.length, 0)
    expect(total).toBe(OUTBOUND.length)
  })

  // The measurement that justifies the screen existing at all.
  it('measures how scattered it is today', () => {
    const s = spread()
    expect(s.messages).toBeGreaterThanOrEqual(30)
    expect(s.screens).toBeGreaterThan(5)      // configured in more than five places
    expect(s.settingKeys).toBeGreaterThan(5)  // across more than five settings keys
    expect(s.ignoring).toBe(3)
  })
})
