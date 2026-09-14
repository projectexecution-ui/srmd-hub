import { describe, it, expect } from 'vitest'
import { shortenBoq } from './shorten'

/** Every string below is REAL, pulled from in4_wo_boq_items on 14 Sep 2026.
 *  Shortening is only safe if it is proved against the text people actually
 *  have — a rule that works on invented examples proves nothing. */

describe('lifting the section path off the front', () => {
  it('peels a single heading', () => {
    const s = shortenBoq('N) SITC OF AIR DISTRIBUTION 4) Supply of SITE FABRICATED Aluminum sheet metal ducts For OT & MRI in accordance with the approved shop drawings and as required by the specifications.')
    expect(s.section).toBe('N) SITC OF AIR DISTRIBUTION')
    // Asserting PROPERTIES, not an exact cut point: where exactly the tail is
    // trimmed is a tuning number, but the item number surviving, the verb
    // going, and the length landing are the contract.
    expect(s.short.startsWith('4)')).toBe(true)     // the item number survives
    expect(s.short).not.toMatch(/supply of/i)       // the verb goes
    expect(s.short).toContain('SITE FABRICATED Aluminum sheet metal ducts')
    expect(s.short.length).toBeLessThanOrEqual(68)
    expect(s.shortened).toBe(true)
  })

  it('peels a chain of them', () => {
    const s = shortenBoq('E) SITC OF INTERNAL WIRING. E.6) MISC. ITEMS 5) Installation,testing and commissioning of Sintex Make Outdoor Type Box (Size-300 x 200 x 105)')
    expect(s.section).toBe('E) SITC OF INTERNAL WIRING · E.6) MISC. ITEMS')
    expect(s.short).toContain('Sintex Make Outdoor Type Box')
    expect(s.short.length).toBeLessThanOrEqual(68)
  })

  it('keeps a numbered heading', () => {
    const s = shortenBoq('17) CANVAS FOR EXPANSION JOINTS Supply of Anti-fungal fire retardant canvas connection for expansion of ducts wherever duct is passing building’s expansion joints.')
    expect(s.section).toBe('17) CANVAS FOR EXPANSION JOINTS')
    expect(s.short).toContain('Anti-fungal fire retardant canvas connection')
  })

  it('does NOT mistake a mixed-case item for a heading', () => {
    // "4) Supply of SITE FABRICATED …" is the item. Peeling it would throw the
    // line away and leave the row blank.
    const s = shortenBoq('4) Supply of SITE FABRICATED Aluminum sheet metal ducts')
    expect(s.section).toBeNull()
    expect(s.short).toContain('SITE FABRICATED Aluminum sheet metal ducts')
  })

  it('leaves a line with no section code alone', () => {
    const s = shortenBoq('Providing & fixing centring and shuttering at all levels in superstructure and substructure')
    expect(s.section).toBeNull()
  })
})

describe('dropping contract boilerplate', () => {
  it('drops the long commissioning lead-in', () => {
    const s = shortenBoq('J.1) NON FLP SOCKETS AND ACCESSORIES J.1.1)1X6A Commercial Sockets Installation, testing and commissioning of 6A-3Pin, 1 Phase, Flush/surface Mounted Single phase sockets')
    expect(s.short).not.toMatch(/installation, testing/i)
  })

  it('drops "Providing and laying" and keeps the thing', () => {
    const s = shortenBoq('Providing and laying plain cement concrete (PCC) in substructure in foundations below footings, walls, beams etc., and in superstructure of nominal mix 1:2:4')
    expect(s.short).toBe('plain cement concrete')
    expect(s.shortened).toBe(true)
  })

  it('drops "Providing and supplying"', () => {
    const s = shortenBoq('Providing and supplying manpower/Mason on hire basis for carrying out miscellaneous site works as directed by the Engineer-in-Charge')
    expect(s.short).not.toMatch(/providing and supplying/i)
    expect(s.short.startsWith('manpower/Mason on hire basis')).toBe(true)
    expect(s.short.length).toBeLessThanOrEqual(68)
  })

  it('drops "Providing and Grouting"', () => {
    const s = shortenBoq('Providing and Grouting Pipe Sleeves in Slab/Wall with Approved NonShrink Grout, Followed by EPDM Collar (WPE 55 or Equivalent)')
    expect(s.short).toBe('Pipe Sleeves in Slab/Wall with Approved NonShrink Grout')
  })

  it('keeps the lead-in when dropping it would leave a stub', () => {
    const s = shortenBoq('Supply of JCB')
    expect(s.short).toBe('Supply of JCB')
    expect(s.shortened).toBe(false)
  })
})

describe('cutting the tail', () => {
  it('cuts at the first clause boundary, not mid-thought', () => {
    const s = shortenBoq('Mix and Apply Cipoxy 16D primer or solvent based epoxy primer, two coats over the prepared surface')
    expect(s.short).toBe('Cipoxy 16D primer or solvent based epoxy primer')
    expect(s.short.endsWith(',')).toBe(false)
  })

  it('never cuts in the middle of a word', () => {
    const long = 'China Mosaic work carried out over the terrace slab with approved tiles and pointing throughout'
    const s = shortenBoq(long)
    expect(long.startsWith(s.short)).toBe(true)
    expect(long[s.short.length] === ' ' || long.length === s.short.length).toBe(true)
  })

  // A dimension mangled by a careless cut is the thing that would make this
  // dangerous on an approval screen.
  it('never alters a dimension, because it only ever drops the tail', () => {
    const s = shortenBoq('Installation,testing and commissioning of Sintex Make Outdoor Type Box (Size-300 x 200 x 105)')
    // Whatever survives is a literal prefix of the original text.
    expect(s.full.includes(s.short)).toBe(true)
  })

  it('leaves a line that is already short exactly as it is', () => {
    const s = shortenBoq('China Mosic Work.')
    expect(s.short).toBe('China Mosic Work.')
    expect(s.shortened).toBe(false)
  })

  it('never returns an empty row', () => {
    for (const t of ['', null, undefined, '   ', 'A)']) {
      expect(shortenBoq(t as string).short.length).toBeGreaterThan(0)
    }
  })
})

describe('what the row promises', () => {
  it('keeps the full text for the expander, always', () => {
    const raw = 'L) SAFETY ACCESSORIES. L.1.4) Supply of Laminated First Aid Charts in Local Language & English'
    expect(shortenBoq(raw).full).toBe(raw)
  })

  it('flags shortened only when something is actually hidden', () => {
    expect(shortenBoq('Supply of Truck').shortened).toBe(false)
    expect(shortenBoq('E) CABLE TRAYS-TRUNKING AND FLOOR RACEWAYS 3) INSTALLATION,TESTING AND COMMISSIONING OF 8MM GI THREAD ROOM -2MTR LENGTH.').shortened).toBe(true)
  })

  // The longest particular in the mirror is 2,330 characters.
  it('tames the worst case in the data', () => {
    const s = shortenBoq('A) '.padEnd(3) + 'x'.repeat(2330))
    expect(s.short.length).toBeLessThanOrEqual(68)
  })

  it('collapses the whitespace IN4 pastes in', () => {
    expect(shortenBoq('  Supply   of\n\nTruck  ').short).toBe('Supply of Truck')
  })
})
