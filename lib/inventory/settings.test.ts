import { describe, it, expect } from 'vitest'
import { parseInvSettings, INV_SETTINGS_DEFAULTS } from './settings'

describe('parseInvSettings', () => {
  it('defaults when unset', () => {
    expect(parseInvSettings({})).toEqual({
      approval_mode: 'always', allow_item_requests: true, low_stock_alerts: true, require_purpose: false,
      daily_report: false, daily_report_emails: [],
    })
    expect(INV_SETTINGS_DEFAULTS.approval_mode).toBe('always')
  })

  it('reads the daily-report toggle and recipient list', () => {
    expect(parseInvSettings({ inv_daily_report: 'true' }).daily_report).toBe(true)
    expect(parseInvSettings({ inv_daily_report_emails: 'a@b.com, c@d.com ; x' }).daily_report_emails)
      .toEqual(['a@b.com', 'c@d.com'])
  })

  it('reads a valid approval_mode override', () => {
    expect(parseInvSettings({ inv_approval_mode: 'off' }).approval_mode).toBe('off')
    expect(parseInvSettings({ inv_approval_mode: 'always' }).approval_mode).toBe('always')
  })

  it('reads the boolean toggles', () => {
    expect(parseInvSettings({ inv_allow_item_requests: 'false' }).allow_item_requests).toBe(false)
    expect(parseInvSettings({ inv_low_stock_alerts: 'off' }).low_stock_alerts).toBe(false)
    expect(parseInvSettings({ inv_require_purpose: 'true' }).require_purpose).toBe(true)
  })

  it('falls back to the default on blank / null / unknown values', () => {
    expect(parseInvSettings({ inv_approval_mode: '' }).approval_mode).toBe('always')
    expect(parseInvSettings({ inv_approval_mode: null }).approval_mode).toBe('always')
    expect(parseInvSettings({ inv_approval_mode: undefined }).approval_mode).toBe('always')
    // 'threshold' isn't buildable without item rates yet → treated as unknown.
    expect(parseInvSettings({ inv_approval_mode: 'threshold' }).approval_mode).toBe('always')
    expect(parseInvSettings({ inv_approval_mode: 'ALWAYS' }).approval_mode).toBe('always')
  })

  it('trims surrounding whitespace', () => {
    expect(parseInvSettings({ inv_approval_mode: '  off  ' }).approval_mode).toBe('off')
  })
})
