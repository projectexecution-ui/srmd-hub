import { describe, expect, it } from 'vitest'
import { in4Key, in4Name, cleanUom, planIn4Items } from './in4-items'

describe('in4Name', () => {
  it('strips the wrapping quotes IN4 puts on SOME names and not others', () => {
    // Both of these are real, off one PO: IN4 quoted 5 of 7 material names.
    expect(in4Name('"KICH SS 316 Door Hinge Without Bearing 102X76X3mm- Satin - DH134S"'))
      .toBe('KICH SS 316 Door Hinge Without Bearing 102X76X3mm- Satin - DH134S')
    expect(in4Name('KICH Zinc Indicator Bolt-Satin - IB106S'))
      .toBe('KICH Zinc Indicator Bolt-Satin - IB106S')
  })

  it('leaves quotes that are part of the name alone — only a wrapping pair goes', () => {
    expect(in4Name('1/2" GI Nipple')).toBe('1/2" GI Nipple')
    expect(in4Name('Pipe 3" x 6"')).toBe('Pipe 3" x 6"')
  })

  it('does not touch anything else about IN4 wording', () => {
    expect(in4Name('  TMT Bars  8MM  ')).toBe('TMT Bars  8MM')
  })
})

describe('in4Key', () => {
  it('collapses the whitespace and punctuation IN4 exports are full of', () => {
    // These are real shapes from the Indent → PO Tracker.
    expect(in4Key('TMT Bars  8MM')).toBe('tmt bars 8mm')
    expect(in4Key('Pidilite - Roff (T02)')).toBe('pidilite roff t02')
    expect(in4Key('25MM : PVC CONDUITE MMS TYPE')).toBe('25mm pvc conduite mms type')
  })

  it('treats the same material sent with different spacing as ONE item', () => {
    expect(in4Key('TMT BARS 8MM')).toBe(in4Key(' tmt-bars   8mm '))
  })

  it('trims, so a stray leading space cannot create a second item', () => {
    expect(in4Key('  OPC 53 Cement  ')).toBe('opc 53 cement')
  })

  it('does not re-word or abbreviate anything — only the key is normalised', () => {
    expect(in4Key('ANGLE COCK SELF CLOSING SYSTEM (F31003ACP)'))
      .toBe('angle cock self closing system f31003acp')
  })

  it('is empty for a name with nothing usable in it', () => {
    expect(in4Key('   ')).toBe('')
    expect(in4Key('---')).toBe('')
  })
})

describe('cleanUom', () => {
  it('keeps what IN4 sent, and calls blank blank', () => {
    expect(cleanUom(' Bag ')).toBe('Bag')
    expect(cleanUom('')).toBeNull()
    expect(cleanUom(null)).toBeNull()
    expect(cleanUom('   ')).toBeNull()
  })
})

describe('planIn4Items', () => {
  it('makes one item per distinct IN4 name, keeping IN4 wording exactly', () => {
    const p = planIn4Items([
      { material: 'OPC 53 Cement', uom: 'Bag', discipline: 'Civil' },
      { material: 'TMT Bars  8MM', uom: 'MT', discipline: 'Civil' },
    ])
    expect(p.wanted.size).toBe(2)
    expect(p.wanted.get('opc 53 cement')).toEqual({ name: 'OPC 53 Cement', uom: 'Bag', discipline: 'Civil' })
    // the stored name keeps IN4's double space, only the KEY is normalised
    expect(p.wanted.get('tmt bars 8mm')!.name).toBe('TMT Bars  8MM')
  })

  it('collapses the same material repeated once per indent into one item', () => {
    const p = planIn4Items([
      { material: 'OPC 53 Cement', uom: 'Bag' },
      { material: 'OPC 53 CEMENT', uom: 'Bag' },
      { material: ' opc-53 cement ', uom: 'Bag' },
    ])
    expect(p.wanted.size).toBe(1)
  })

  it('treats a quoted and an unquoted copy of the same name as one item', () => {
    const p = planIn4Items([
      { material: '"KICH Zinc Indicator Bolt-Satin - IB106S"', uom: 'Nos' },
      { material: 'KICH Zinc Indicator Bolt-Satin - IB106S', uom: 'Nos' },
    ])
    expect(p.wanted.size).toBe(1)
    // and the stored name has no stray quote on it
    expect([...p.wanted.values()][0].name).toBe('KICH Zinc Indicator Bolt-Satin - IB106S')
  })

  it('fills in a UOM from a later line when the first one had none', () => {
    const p = planIn4Items([
      { material: 'Binding Wire', uom: '' },
      { material: 'Binding Wire', uom: 'Kg' },
    ])
    expect(p.wanted.get('binding wire')!.uom).toBe('Kg')
    expect(p.uomConflicts).toEqual([])
  })

  it('reports a UOM conflict instead of silently picking one', () => {
    const p = planIn4Items([
      { material: 'Cement', uom: 'Bag' },
      { material: 'Cement', uom: 'MT' },
    ])
    expect(p.wanted.get('cement')!.uom).toBe('Bag')       // first wins
    expect(p.uomConflicts).toEqual([{ name: 'Cement', kept: 'Bag', alsoSeen: 'MT' }])
  })

  it('picks up a discipline from whichever line has one', () => {
    const p = planIn4Items([
      { material: 'Copper Wire', uom: 'Coil', discipline: null },
      { material: 'Copper Wire', uom: 'Coil', discipline: 'Electrical' },
    ])
    expect(p.wanted.get('copper wire')!.discipline).toBe('Electrical')
  })

  it('counts the lines IN4 sent with no material name rather than inventing items', () => {
    const p = planIn4Items([
      { material: 'Cement', uom: 'Bag' },
      { material: '', uom: 'Bag' },
      { material: '   ', uom: 'Bag' },
      { material: '--', uom: 'Bag' },
      { material: null, uom: null },
    ])
    expect(p.wanted.size).toBe(1)
    expect(p.unnamed).toBe(4)
  })

  it('is empty, not broken, for an empty PO', () => {
    const p = planIn4Items([])
    expect(p.wanted.size).toBe(0)
    expect(p.unnamed).toBe(0)
    expect(p.uomConflicts).toEqual([])
  })
})
