import { describe, it, expect } from 'vitest'
import {
  T, ALL_PHRASES, modePhrase, modeIcon, stepsFor, canLeave, summaryOf, GATE_STEPS,
  show, parseFieldLang, DEFAULT_FIELD_LANG, FIELD_LANG_KEY,
} from './lang'

describe('the bilingual dictionary', () => {
  it('gives every phrase both languages, non-empty', () => {
    const missing = ALL_PHRASES.filter(([, p]) => !p.en?.trim() || !p.gu?.trim()).map(([k]) => k)
    expect(missing).toEqual([])
  })

  it('really is Gujarati, not English copied into the second slot', () => {
    const gujarati = /[઀-૿]/
    const notGujarati = ALL_PHRASES.filter(([, p]) => !gujarati.test(p.gu)).map(([k]) => k)
    expect(notGujarati).toEqual([])
  })

  it('keeps the English side short enough for a phone', () => {
    const tooLong = ALL_PHRASES.filter(([, p]) => p.en.length > 34).map(([k, p]) => `${k}: ${p.en}`)
    expect(tooLong).toEqual([])
  })

  it('says things in words, not system jargon', () => {
    const jargon = /\b(entity|param|record|entry id|null|slug|field)\b/i
    expect(ALL_PHRASES.filter(([, p]) => jargon.test(p.en)).map(([k]) => k)).toEqual([])
  })
})

describe('delivery modes', () => {
  it('translates the five the map lists', () => {
    for (const m of ['Trailer', 'Truck', 'Tempo', 'Pickup', 'Hand Delivered']) {
      expect(modePhrase(m).gu.length).toBeGreaterThan(0)
    }
  })

  it('gives a mode an admin invents its own name and NO wrong translation', () => {
    const p = modePhrase('Bullock cart')
    expect(p.en).toBe('Bullock cart')
    expect(p.gu).toBe('')
  })

  it('picks the picture from the word, so a rename keeps it', () => {
    expect(modeIcon('Truck')).toBe('truck')
    expect(modeIcon('Small Tempo (new)')).toBe('tempo')
    expect(modeIcon('Hand Delivered')).toBe('hand')
    expect(modeIcon('Bullock cart')).toBe('other')
  })
})

describe('the gate wizard', () => {
  it('has seven steps, ending on a check', () => {
    expect(GATE_STEPS).toHaveLength(7)
    expect(GATE_STEPS[GATE_STEPS.length - 1]).toBe('check')
  })

  it('skips vehicle and driver for hand-delivered material', () => {
    const steps = stepsFor({ modeName: 'Hand Delivered' })
    expect(steps).not.toContain('vehicle')
    expect(steps).not.toContain('driver')
    expect(steps).toHaveLength(5)
  })

  it('keeps them for everything else', () => {
    expect(stepsFor({ modeName: 'Truck' })).toHaveLength(7)
    expect(stepsFor({})).toHaveLength(7)
  })

  it('makes only what / who / how compulsory', () => {
    expect(canLeave('what', {})).toBe(false)
    expect(canLeave('what', { register: 'srm' })).toBe(true)
    expect(canLeave('who', { partyName: '  ' })).toBe(false)
    expect(canLeave('who', { partyName: 'Balaji' })).toBe(true)
    expect(canLeave('how', {})).toBe(false)
  })

  it('lets a guard finish without the vehicle, driver or licence', () => {
    // The lorry must not wait at the gate for a number nobody has.
    for (const s of ['vehicle', 'driver', 'papers', 'check'] as const) {
      expect(canLeave(s, {})).toBe(true)
    }
  })

  it('shows only the answers actually given, in reading order', () => {
    const rows = summaryOf({
      register: 'vendor', partyName: 'Balaji Steel', modeName: 'Truck', vehicleNo: 'GJ05BX4417',
    })
    expect(rows.map(r => r.value)).toEqual(['Vendor material', 'Balaji Steel', 'Truck', 'GJ05BX4417'])
  })

  it('leaves blank answers off the summary rather than showing empty rows', () => {
    expect(summaryOf({ register: 'srm', driverName: '   ' })).toHaveLength(1)
  })

  it('trims what it shows, so a stray space is not saved as the name', () => {
    expect(summaryOf({ partyName: '  Balaji  ' })[0].value).toBe('Balaji')
  })
})

describe('the words themselves', () => {
  it('asks "Who has brought it?" rather than naming a database column', () => {
    expect(T.qWho.en).toBe('Who has brought it?')
    expect(T.qWho.en.toLowerCase()).not.toContain('party')
  })

  it('labels the two registers by where the material GOES, not by system name', () => {
    expect(T.vendorSub.en).toContain('site')
    expect(T.srmSub.en).toContain('store')
  })
})

describe('the language switch', () => {
  it('defaults to Gujarati, which is what the gate staff read', () => {
    expect(DEFAULT_FIELD_LANG).toBe('gu')
  })

  it('shows Gujarati alone when set to gu', () => {
    const s = show(T.qWho, 'gu')
    expect(s.lead).toBe(T.qWho.gu)
    expect(s.leadLang).toBe('gu')
    expect(s.second).toBeNull()
  })

  it('leads with English and follows with Gujarati when set to both', () => {
    const s = show(T.qWho, 'both')
    expect(s.lead).toBe(T.qWho.en)
    expect(s.second).toBe(T.qWho.gu)
    expect(s.secondLang).toBe('gu')
  })

  it('falls back to English when a phrase has no Gujarati — a blank label is worse', () => {
    const invented = { en: 'Bullock cart', gu: '' }
    for (const lang of ['gu', 'both'] as const) {
      const s = show(invented, lang)
      expect(s.lead).toBe('Bullock cart')
      expect(s.leadLang).toBe('en')
      expect(s.second).toBeNull()
    }
  })

  it('never returns an empty lead, whatever it is handed', () => {
    for (const [, p] of ALL_PHRASES) {
      for (const lang of ['gu', 'both'] as const) {
        expect(show(p, lang).lead.length).toBeGreaterThan(0)
      }
    }
  })

  it('reads a stored value, and refuses to crash on a bad one', () => {
    expect(parseFieldLang('gu')).toBe('gu')
    expect(parseFieldLang('both')).toBe('both')
    for (const junk of [null, undefined, '', 'hi', 'GU', 42, {}]) {
      expect(parseFieldLang(junk)).toBe('gu')
    }
  })

  it('keys the setting where app_settings is already admin-write-only', () => {
    expect(FIELD_LANG_KEY).toBe('mio_field_language')
  })
})
