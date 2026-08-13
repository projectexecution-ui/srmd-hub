import { describe, expect, it } from 'vitest'
import { aliasKey, suggestItems } from './match'

/** Item names below are REAL rows from wh_items, and the material strings are
 *  REAL values from the Indent → PO Tracker — the exact pairs that showed why
 *  an exact match only worked for 1.3% of names. */
const ITEMS = [
  { id: 'a', name: 'TEPLON TAPE (YELLOW)',                        unit: 'Nos' },
  { id: 'b', name: 'ANGLE COCK SELF CLOSING SYSTEM (F31003ACP)',  unit: 'Nos' },
  { id: 'c', name: '50 x 50mm CPVC BRASS MTA',                    unit: 'Nos' },
  { id: 'd', name: '100 x 80 mm CPVC BUSHING',                    unit: 'Nos' },
  { id: 'e', name: '100mm CPVC CUPLER',                           unit: 'Nos' },
  { id: 'f', name: '25MM 1 WAY  JUNCTION IVORY  ( YUNUS 26 )',    unit: 'Nos' },
  { id: 'g', name: '25MM  SHOU BEND 45DEG 10KG',                  unit: 'Nos' },
  { id: 'h', name: '10W LED Boat bulk Head Light ( Netural White )', unit: 'Nos' },
  { id: 'i', name: '16W LED LIME LIGHT',                          unit: 'Nos' },
  { id: 'j', name: '1/2M GI STEEL BOX',                           unit: 'Nos' },
  { id: 'k', name: 'TMT Bar 8mm',                                 unit: 'MT'  },
]

const top = (material: string) => suggestItems(material, ITEMS)[0]

describe('aliasKey', () => {
  it('collapses the whitespace and punctuation IN4 exports are full of', () => {
    // the tracker really does write "TMT Bars  8MM" with a double space
    expect(aliasKey('TMT Bars  8MM')).toBe('tmt bars 8mm')
    expect(aliasKey('Pidilite - Roff (T02)')).toBe('pidilite roff t02')
    expect(aliasKey('25MM : PVC CONDUITE MMS TYPE')).toBe('25mm pvc conduite mms type')
  })
})

describe('suggestItems', () => {
  it('finds the item when our master just adds a colour or code', () => {
    expect(top('TEPLON TAPE')?.name).toBe('TEPLON TAPE (YELLOW)')
    expect(top('ANGLE COCK')?.name).toBe('ANGLE COCK SELF CLOSING SYSTEM (F31003ACP)')
  })

  it('never crosses a size — 25mm is not 50mm', () => {
    const all = suggestItems('25MM COUPLER', ITEMS)
    expect(all.every(s => !s.name.includes('50mm'))).toBe(true)
    expect(all.every(s => !s.name.includes('100mm'))).toBe(true)
  })

  it('respects the size when several fittings share a word', () => {
    const s = suggestItems('50MM CPVC ELBOW', ITEMS)
    // only the 50mm CPVC row may appear; the 100mm ones are disqualified
    expect(s.every(x => !x.name.startsWith('100'))).toBe(true)
  })

  it('offers nothing for material that simply is not site stock', () => {
    expect(suggestItems('Ink Cartridge - Black', ITEMS)).toHaveLength(0)
    expect(suggestItems('Pidilite - Roff (T02)', ITEMS)).toHaveLength(0)
  })

  it('picks the matching wattage among lights rather than the first one', () => {
    expect(top('16W LED LIME LIGHT')?.name).toBe('16W LED LIME LIGHT')
  })

  it('scores an exact name at or near the top of the range', () => {
    const s = top('TMT Bar 8mm')
    expect(s?.name).toBe('TMT Bar 8mm')
    expect(s!.score).toBeGreaterThan(0.9)
  })

  it('keeps a loose guess low enough that nobody accepts it by reflex', () => {
    const s = top('Light Fans etc-Ceiling Light')
    // "light" alone matches two lamp rows — offered, but clearly not confident
    if (s) expect(s.score).toBeLessThan(0.6)
  })
})
