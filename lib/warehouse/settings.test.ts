import { describe, expect, it } from 'vitest'
import {
  SETTINGS, SECTIONS, NOT_BUILT, settingDef, rawValue, isOn, valuesHiddenRoles,
  showValuesFor, periodLock, periodLockBlocker,
} from './settings'

describe('the setting catalogue', () => {
  it('has a unique key per setting', () => {
    const keys = SETTINGS.map(s => s.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('puts every setting in a section that exists', () => {
    const sections = new Set(SECTIONS.map(s => s.key))
    for (const s of SETTINGS) expect(sections.has(s.section)).toBe(true)
  })

  it('keeps the page short — four sections, and every rule in one of them', () => {
    // It was ten sections for nine settings, three of which existed only to
    // hold "not built" notes. Aksha: "too much of Brain to be used."
    expect(SECTIONS).toHaveLength(4)
    expect(SETTINGS.every(s => s.section === 'rules')).toBe(true)
  })

  it('still lists what is NOT built, so a reader can tell the real switches apart', () => {
    expect(NOT_BUILT.length).toBeGreaterThan(0)
    for (const n of NOT_BUILT) expect(n.why.length).toBeGreaterThan(40)
  })

  it('says what happens when a switch is OFF, not just on', () => {
    // A switch that only explains its "on" state hides the consequence of
    // turning it off, which is the decision actually being made.
    for (const s of SETTINGS) {
      expect(s.onEffect.length).toBeGreaterThan(30)
      expect(s.offEffect.length).toBeGreaterThan(30)
    }
  })

  it('says where each rule is actually applied, so it can be checked', () => {
    for (const s of SETTINGS) expect(s.enforcedAt.length).toBeGreaterThan(10)
  })

  it('gives a real reason for every rule that is not built', () => {
    for (const n of NOT_BUILT) expect(n.why.length).toBeGreaterThan(40)
  })

  it('finds a setting by key and refuses one that does not exist', () => {
    expect(settingDef('wh_freeze_during_count')?.section).toBe('rules')
    expect(settingDef('wh_make_tea')).toBeNull()
  })
})

describe('reading values', () => {
  it('falls back to the default when nothing has been saved', () => {
    expect(isOn({}, 'wh_blind_count_default')).toBe(true)
    expect(isOn({}, 'wh_period_lock_on')).toBe(false)
    expect(isOn({}, 'wh_any_keeper_any_store')).toBe(false)
  })

  it('uses a saved value over the default, including a saved "false"', () => {
    expect(isOn({ wh_blind_count_default: 'false' }, 'wh_blind_count_default')).toBe(false)
    expect(isOn({ wh_period_lock_on: 'true' }, 'wh_period_lock_on')).toBe(true)
  })

  it('treats anything that is not "true" as off, rather than guessing', () => {
    expect(isOn({ wh_freeze_during_count: '1' }, 'wh_freeze_during_count')).toBe(false)
    expect(isOn({ wh_freeze_during_count: 'yes' }, 'wh_freeze_during_count')).toBe(false)
  })

  it('reads the empty string as a real saved value, not as missing', () => {
    expect(rawValue({ wh_period_lock_date: '' }, 'wh_period_lock_date')).toBe('')
  })
})

describe('valuesHiddenRoles / showValuesFor', () => {
  it('hides money from the default roles — ones people actually hold', () => {
    // The old default was security + site_staff + contractor. Nobody held the
    // first two and a contractor cannot open the module, so a switch marked
    // Recommended protected nobody while all 40 people with access read every
    // rate. Now: the 27 viewers, the 2 engineers, and security for the day a
    // gate guard exists.
    expect(valuesHiddenRoles({})).toEqual(['security', 'viewer', 'engineer'])
    expect(showValuesFor({}, 'viewer', false)).toBe(false)
    expect(showValuesFor({}, 'engineer', false)).toBe(false)
    expect(showValuesFor({}, 'security', false)).toBe(false)
  })

  it('shows money to everyone else', () => {
    expect(showValuesFor({}, 'head', false)).toBe(true)
    expect(showValuesFor({}, 'store_manager', false)).toBe(true)
  })

  it('an admin always sees values, whatever the list says', () => {
    expect(showValuesFor({ wh_values_hidden_roles: 'security,head,admin' }, 'admin', true)).toBe(true)
    expect(showValuesFor({ wh_values_hidden_roles: 'head' }, 'head', true)).toBe(true)
  })

  it('follows the saved list once it is changed', () => {
    const v = { wh_values_hidden_roles: 'engineer, security ' }
    expect(valuesHiddenRoles(v)).toEqual(['engineer', 'security'])
    expect(showValuesFor(v, 'engineer', false)).toBe(false)
    expect(showValuesFor(v, 'contractor', false)).toBe(true)   // no longer hidden
  })

  it('shows values when the list is emptied — that is what emptying it means', () => {
    expect(showValuesFor({ wh_values_hidden_roles: '' }, 'security', false)).toBe(true)
  })

  it('does not hide from someone with no role at all rather than locking them out', () => {
    expect(showValuesFor({}, null, false)).toBe(true)
  })
})

describe('periodLock', () => {
  const on = { wh_period_lock_on: 'true', wh_period_lock_date: '2026-03-31' }

  it('is off unless both the switch and a date are set', () => {
    expect(periodLock({})).toBeNull()
    expect(periodLock({ wh_period_lock_on: 'true' })).toBeNull()
    expect(periodLock({ wh_period_lock_date: '2026-03-31' })).toBeNull()
    expect(periodLock(on)).toBe('2026-03-31')
  })

  it('ignores a date that is not a real date', () => {
    expect(periodLock({ wh_period_lock_on: 'true', wh_period_lock_date: '31-03-2026' })).toBeNull()
    expect(periodLock({ wh_period_lock_on: 'true', wh_period_lock_date: 'March' })).toBeNull()
  })
})

describe('periodLockBlocker', () => {
  const on = { wh_period_lock_on: 'true', wh_period_lock_date: '2026-03-31' }

  it('refuses an entry dated before the lock', () => {
    expect(periodLockBlocker(on, '2026-03-30')).toMatch(/closed up to and including 2026-03-31/)
  })

  it('refuses the locked date ITSELF — "locked up to 31 March" must close 31 March', () => {
    expect(periodLockBlocker(on, '2026-03-31')).not.toBeNull()
  })

  it('allows the day after, and anything later', () => {
    expect(periodLockBlocker(on, '2026-04-01')).toBeNull()
    expect(periodLockBlocker(on, '2026-08-13')).toBeNull()
  })

  it('blocks nothing when the lock is off', () => {
    expect(periodLockBlocker({}, '2020-01-01')).toBeNull()
    expect(periodLockBlocker({ wh_period_lock_date: '2026-03-31' }, '2020-01-01')).toBeNull()
  })

  it('blocks nothing for an entry with no date rather than throwing', () => {
    expect(periodLockBlocker(on, '')).toBeNull()
  })
})
