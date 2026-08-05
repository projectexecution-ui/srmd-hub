import { describe, it, expect } from 'vitest'
import { parseInvSettings, INV_SETTINGS_DEFAULTS } from './settings'

describe('parseInvSettings', () => {
  it('defaults to one Atm Head approval (always) when unset', () => {
    expect(parseInvSettings({})).toEqual({ approval_mode: 'always' })
    expect(INV_SETTINGS_DEFAULTS.approval_mode).toBe('always')
  })

  it('reads a valid override', () => {
    expect(parseInvSettings({ inv_approval_mode: 'off' })).toEqual({ approval_mode: 'off' })
    expect(parseInvSettings({ inv_approval_mode: 'always' })).toEqual({ approval_mode: 'always' })
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
