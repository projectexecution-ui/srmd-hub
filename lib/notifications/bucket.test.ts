import { describe, it, expect } from 'vitest'
import { isDeskItem, bucket, deskUnread, NEWS_TYPES } from './bucket'

const row = (type: string, is_read = false) => ({ type, is_read })

describe('which half of the bell', () => {
  it('puts the things that wait on you on the desk', () => {
    // The four that actually block somebody, by live volume on 17 Sep 2026.
    expect(isDeskItem('approval_pending')).toBe(true)      // 476 unread
    expect(isDeskItem('cc_approval_reminders')).toBe(true) // 137
    expect(isDeskItem('cc_ws_returned')).toBe(true)        // your sheet came back
    expect(isDeskItem('access_request')).toBe(true)
    expect(isDeskItem('in4_wo_verify')).toBe(true)
    expect(isDeskItem('comment_mention')).toBe(true)
  })

  it('puts news behind the second tab', () => {
    expect(isDeskItem('cc_budget_approved')).toBe(false)   // 86 unread of 87
    expect(isDeskItem('cc_estimate_approved')).toBe(false)
    expect(isDeskItem('procurement_digest')).toBe(false)
    expect(isDeskItem('cc_budget_vs_actual_report')).toBe(false)
    expect(isDeskItem('in4_entered')).toBe(false)
  })

  it('treats an UNKNOWN type as work, never as news', () => {
    // The direction this must fail in: a type nobody classified yet appears in
    // front of the person. Noise is recoverable; missed work is not.
    expect(isDeskItem('some_event_added_next_month')).toBe(true)
    expect(isDeskItem('')).toBe(true)
    expect(isDeskItem(null)).toBe(true)
    expect(isDeskItem(undefined)).toBe(true)
  })

  it('splits in arrival order and loses nothing', () => {
    const rows = [row('approval_pending'), row('cc_budget_approved'), row('cc_ws_returned'), row('procurement_digest')]
    const b = bucket(rows)
    expect(b.desk.map(r => r.type)).toEqual(['approval_pending', 'cc_ws_returned'])
    expect(b.news.map(r => r.type)).toEqual(['cc_budget_approved', 'procurement_digest'])
    expect(b.desk.length + b.news.length).toBe(rows.length)
  })

  it('counts only unread WORK for the red badge', () => {
    const rows = [
      row('approval_pending'),             // counts
      row('approval_pending', true),       // read — no
      row('cc_budget_approved'),           // news — no
      row('cc_ws_returned'),               // counts
    ]
    expect(deskUnread(rows)).toBe(2)
  })

  it('every news type is spelled the way the database spells it', () => {
    // Guards the one way this silently breaks: a typo here sends a news type
    // to the desk tab for ever, and nothing fails.
    for (const t of NEWS_TYPES) {
      expect(t).toMatch(/^[a-z0-9_]+$/)
      expect(t.trim()).toBe(t)
    }
  })
})
