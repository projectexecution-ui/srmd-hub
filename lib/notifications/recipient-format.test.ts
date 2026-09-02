import { describe, it, expect } from 'vitest'
import {
  KEY_SPECS, specFor, parseList, serialiseList, parseFlag, serialiseFlag, validEmails,
} from './recipient-format'
import { OUTBOUND } from './catalog'

describe('writing a setting back in its own format', () => {
  // The whole reason this file exists. Each of these round-trips must match
  // what the module's own form writes and what the cron job reads.
  it('keeps bills_worklist_to as a comma-joined string, as its own form writes it', () => {
    expect(serialiseList('bills_worklist_to', ['a@b.com', 'c@d.com'])).toBe('a@b.com, c@d.com')
  })

  it('keeps inv_daily_report_emails as a comma-joined string', () => {
    expect(serialiseList('inv_daily_report_emails', ['a@b.com'])).toBe('a@b.com')
  })

  it('keeps jmr_weekly_report_recipients as a JSON array, as its own form writes it', () => {
    expect(serialiseList('jmr_weekly_report_recipients', ['a@b.com'])).toBe('["a@b.com"]')
  })

  it('round-trips every list key through its own format', () => {
    const sample = ['a@b.com', 'c@d.com']
    for (const [key, spec] of Object.entries(KEY_SPECS)) {
      if (spec.format === 'bool') continue
      expect(parseList(key, serialiseList(key, sample)), key).toEqual(sample)
    }
  })

  // The inventory cron splits on [,;\s]+ — a value written with only commas
  // and a value written with semicolons must both read back the same.
  it('reads a csv list however it was separated', () => {
    expect(parseList('inv_daily_report_emails', 'a@b.com, c@d.com')).toEqual(['a@b.com', 'c@d.com'])
    expect(parseList('inv_daily_report_emails', 'a@b.com;c@d.com')).toEqual(['a@b.com', 'c@d.com'])
    expect(parseList('inv_daily_report_emails', 'a@b.com c@d.com')).toEqual(['a@b.com', 'c@d.com'])
  })

  it('reads an empty JSON array as nobody', () => {
    expect(parseList('jmr_weekly_report_recipients', '[]')).toEqual([])
  })

  it('survives a malformed JSON value rather than throwing', () => {
    expect(parseList('jmr_weekly_report_recipients', '{oops')).toEqual([])
  })

  it('treats a missing value as nobody', () => {
    expect(parseList('bills_worklist_to', null)).toEqual([])
    expect(parseList('bills_worklist_to', undefined)).toEqual([])
    expect(parseList('bills_worklist_to', '')).toEqual([])
  })

  it('drops blanks rather than writing empty entries', () => {
    expect(serialiseList('bills_worklist_to', ['a@b.com', '  ', ''])).toBe('a@b.com')
    expect(serialiseList('jmr_weekly_report_recipients', ['a@b.com', ''])).toBe('["a@b.com"]')
  })

  it('writes an empty list without corrupting the format', () => {
    expect(serialiseList('bills_worklist_to', [])).toBe('')
    expect(serialiseList('jmr_weekly_report_recipients', [])).toBe('[]')
  })

  // Guessing here would corrupt a setting a cron reads at 09:00 tomorrow, and
  // nothing would report the failure.
  it('refuses to write a key it has no recorded format for', () => {
    expect(() => serialiseList('some_new_key', ['a@b.com'])).toThrow(/refusing to guess/i)
  })

  it('refuses to write a list into an on/off switch', () => {
    expect(() => serialiseList('bills_digest_enabled', ['a@b.com'])).toThrow(/on\/off switch/i)
  })

  it('knows inv_low_stock_alerts is a switch, not an address list', () => {
    expect(specFor('inv_low_stock_alerts')!.format).toBe('bool')
    expect(specFor('inv_low_stock_alerts')!.holds).toBe('flag')
  })

  it('knows bills_digest_cc holds user ids, not addresses', () => {
    expect(specFor('bills_digest_cc')!.holds).toBe('user')
  })

  it('writes flags exactly as the existing forms do', () => {
    expect(serialiseFlag(true)).toBe('true')
    expect(serialiseFlag(false)).toBe('false')
  })

  it('reads the flag spellings the inventory parser accepts', () => {
    expect(parseFlag('true')).toBe(true)
    expect(parseFlag('1')).toBe(true)
    expect(parseFlag('on')).toBe(true)
    expect(parseFlag('false')).toBe(false)
    expect(parseFlag('off')).toBe(false)
    expect(parseFlag(null, true)).toBe(true)
    expect(parseFlag('', false)).toBe(false)
  })

  it('records which module screen also writes each key, so both stay in step', () => {
    for (const [key, spec] of Object.entries(KEY_SPECS)) {
      expect(spec.alsoWrittenBy.startsWith('/'), key).toBe(true)
    }
  })

  // If the catalog names a key the format registry does not know, the editor
  // would offer a control that then refuses to save.
  it('has a format for every address list the catalog offers', () => {
    for (const m of OUTBOUND) {
      if (m.recipients.kind !== 'addresses') continue
      expect(specFor(m.recipients.settingKey), m.key).toBeDefined()
      expect(specFor(m.recipients.settingKey)!.holds, m.key).toBe('email')
    }
  })

  it('has a format for every on/off key the catalog offers', () => {
    for (const m of OUTBOUND) {
      if (!m.enabledKey) continue
      expect(specFor(m.enabledKey), m.key).toBeDefined()
      expect(specFor(m.enabledKey)!.format, m.key).toBe('bool')
    }
  })
})

describe('checking addresses before they are saved', () => {
  it('accepts ordinary addresses', () => {
    expect(validEmails(['a@b.com', 'x.y@srmd.org']).ok).toEqual(['a@b.com', 'x.y@srmd.org'])
  })

  it('rejects anything that is not an address, and says which', () => {
    const r = validEmails(['a@b.com', 'Mayank', 'nope@'])
    expect(r.ok).toEqual(['a@b.com'])
    expect(r.rejected).toEqual(['Mayank', 'nope@'])
  })

  it('ignores blanks and stray spacing', () => {
    expect(validEmails(['  a@b.com  ', '', '   ']).ok).toEqual(['a@b.com'])
    expect(validEmails(['  a@b.com  ']).rejected).toEqual([])
  })

  it('rejects an address with no dot in the domain', () => {
    expect(validEmails(['a@localhost']).rejected).toEqual(['a@localhost'])
  })
})
