import { describe, it, expect } from 'vitest'
import { T, ALL_PHRASES, modeIcon, stepsFor, canLeave, summaryOf, GATE_STEPS } from './lang'

/**
 * These tests are what survives the bilingual experiment.
 *
 * The screens are English again, but the DISCIPLINE the Gujarati forced is
 * worth keeping: one list, plain words, short enough for a phone. That is the
 * part actually doing the work for someone who reads slowly.
 */
describe('the words on the field screens', () => {
  it('has no empty phrase', () => {
    expect(ALL_PHRASES.filter(([, v]) => !v.trim()).map(([k]) => k)).toEqual([])
  })

  it('keeps every line short enough for a phone', () => {
    const tooLong = ALL_PHRASES.filter(([, v]) => v.length > 34).map(([k, v]) => `${k}: ${v}`)
    expect(tooLong).toEqual([])
  })

  it('says things in words, not system jargon', () => {
    const jargon = /\b(entity|param|record|entry id|null|slug|field)\b/i
    expect(ALL_PHRASES.filter(([, v]) => jargon.test(v)).map(([k]) => k)).toEqual([])
  })

  it('carries no leftover Gujarati — it was removed, not hidden behind a flag', () => {
    const gujarati = /[઀-૿]/
    expect(ALL_PHRASES.filter(([, v]) => gujarati.test(v)).map(([k]) => k)).toEqual([])
  })

  it('asks "Who has brought it?" rather than naming a database column', () => {
    expect(T.qWho).toBe('Who has brought it?')
    expect(T.qWho.toLowerCase()).not.toContain('party')
  })

  it('labels the two registers by where the material GOES, not by system name', () => {
    expect(T.vendorSub).toContain('site')
    expect(T.srmSub).toContain('store')
  })
})

describe('delivery mode pictures', () => {
  it('picks the picture from the word, so a rename keeps it', () => {
    expect(modeIcon('Truck')).toBe('truck')
    expect(modeIcon('Trailer')).toBe('trailer')
    expect(modeIcon('Small Tempo (new)')).toBe('tempo')
    expect(modeIcon('Pickup')).toBe('pickup')
    expect(modeIcon('Hand Delivered')).toBe('hand')
  })

  it('gives a mode an admin invents a neutral box rather than a wrong picture', () => {
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
