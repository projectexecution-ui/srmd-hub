import { describe, it, expect } from 'vitest'
import { parseCcSettings, CC_SETTINGS_DEFAULTS } from './settings'

describe('parseCcSettings', () => {
  it('empty map returns the defaults (deadlines OFF by default)', () => {
    const s = parseCcSettings({})
    expect(s).toEqual(CC_SETTINGS_DEFAULTS)
    expect(s.show_deadlines).toBe(false)
    expect(s.show_erp_columns).toBe(true)
  })

  it('boolean overrides: true/1/on are truthy, anything else is false', () => {
    expect(parseCcSettings({ cc_show_deadlines: 'true' }).show_deadlines).toBe(true)
    expect(parseCcSettings({ cc_show_deadlines: '1' }).show_deadlines).toBe(true)
    expect(parseCcSettings({ cc_show_deadlines: 'on' }).show_deadlines).toBe(true)
    expect(parseCcSettings({ cc_show_erp_columns: 'false' }).show_erp_columns).toBe(false)
    expect(parseCcSettings({ cc_show_erp_columns: 'nonsense' }).show_erp_columns).toBe(false)
  })

  it('empty string falls back to the default (not false)', () => {
    expect(parseCcSettings({ cc_show_erp_columns: '' }).show_erp_columns).toBe(true)
  })

  it('label overrides apply, are trimmed and capped at 60 chars', () => {
    expect(parseCcSettings({ cc_label_ph_checked: '  PH Verified ₹  ' }).label_ph_checked).toBe('PH Verified ₹')
    expect(parseCcSettings({ cc_label_ph_checked: 'x'.repeat(100) }).label_ph_checked).toHaveLength(60)
    expect(parseCcSettings({ cc_label_atm_checked: '   ' }).label_atm_checked).toBe('Atm Head Checked Amt')
  })

  it('engineer visibility defaults to the most locked state', () => {
    const s = parseCcSettings({})
    expect(s.eng_estimates).toBe('own')
    expect(s.eng_projects).toBe(false)
    expect(s.eng_erp).toBe(false)
  })

  it('engineer estimate scope only accepts own/projects/all, else default', () => {
    expect(parseCcSettings({ cc_eng_estimates: 'all' }).eng_estimates).toBe('all')
    expect(parseCcSettings({ cc_eng_estimates: 'projects' }).eng_estimates).toBe('projects')
    expect(parseCcSettings({ cc_eng_estimates: 'garbage' }).eng_estimates).toBe('own')
    expect(parseCcSettings({ cc_eng_estimates: '' }).eng_estimates).toBe('own')
  })
})
