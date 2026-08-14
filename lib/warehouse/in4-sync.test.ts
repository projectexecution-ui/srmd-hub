import { describe, expect, it } from 'vitest'
import { plan, isRealPo, entityFromIndent, GROUP_META } from './in4-sync'
import type { SyncLine, SyncExisting } from './in4-sync'

const empty = (): SyncExisting => ({
  byIn4Key: new Map(), byNameKey: new Map(),
  units: new Set(), disciplines: new Set(), poNos: new Set(),
  projectsByName: new Map(),
})

const line = (over: Partial<SyncLine> & { material: string }): SyncLine => ({
  uom: 'Nos', discipline: null, indentNo: null, project: null, pos: [], ...over,
})

const po = (over: Partial<SyncLine['pos'][number]> & { poNo: string }) => ({
  poDate: 'Apr 01, 2025', supplier: 'Ultratech', rate: 392, qty: 100, ...over,
})

describe('entityFromIndent', () => {
  it('reads the entity out of a real indent number', () => {
    expect(entityFromIndent('IND/SRASSK/NGH/2024-25/195')).toBe('SRASSK')
    expect(entityFromIndent('IND/SRJT/SRAH/2023-24/2')).toBe('SRJT')
  })
  it('is null when there is nothing to read', () => {
    expect(entityFromIndent(null)).toBeNull()
    expect(entityFromIndent('')).toBeNull()
    expect(entityFromIndent('IND')).toBeNull()
  })
})

describe('isRealPo', () => {
  it('accepts an issued, IN4-numbered PO', () => {
    expect(isRealPo(po({ poNo: 'PO/SRASSK/NGH/2024-25/194' }))).toBe(true)
  })
  it('refuses a draft, however it is marked', () => {
    expect(isRealPo(po({ poNo: 'PO/X/1', draft: true }))).toBe(false)
    expect(isRealPo(po({ poNo: 'DRAFT-PO/SRASSK/DN/2023-24/35' }))).toBe(false)
  })
  it('refuses one the parser inferred — IN4 never gave that number', () => {
    expect(isRealPo(po({ poNo: 'PO/X/2', inferred: true }))).toBe(false)
  })
  it('refuses a blank number', () => {
    expect(isRealPo(po({ poNo: '  ' }))).toBe(false)
  })
})

describe('items', () => {
  it('plans one item per distinct IN4 name, keeping IN4 wording', () => {
    const p = plan([
      line({ material: 'OPC 53 Cement', uom: 'Bags', discipline: '03 Civil' }),
      line({ material: 'OPC 53 CEMENT', uom: 'Bags' }),          // same item
      line({ material: 'TMT Bars  8MM', uom: 'MT', discipline: '03 Civil' }),
    ], empty())
    expect(p.items.create).toHaveLength(2)
    expect(p.items.create.map(i => i.name).sort()).toEqual(['OPC 53 Cement', 'TMT Bars  8MM'])
    expect(p.items.create.find(i => i.name === 'OPC 53 Cement')!.discipline).toBe('03 Civil')
  })

  it('does not re-create an item already linked to its IN4 name', () => {
    const have = empty()
    have.byIn4Key.set('opc 53 cement', { id: 'i1', unit: 'Bags' })
    const p = plan([line({ material: 'OPC 53 Cement', uom: 'Bags' })], have)
    expect(p.items.create).toHaveLength(0)
    expect(p.items.alreadyThere).toBe(1)
  })

  it('ADOPTS an item we typed by hand rather than creating a twin that splits its stock', () => {
    const have = empty()
    have.byNameKey.set('opc 53 cement', { id: 'manual-1', unit: 'Bag' })
    const p = plan([line({ material: 'OPC 53 Cement', uom: 'Bags' })], have)
    expect(p.items.create).toHaveLength(0)
    expect(p.items.adopt).toHaveLength(1)
    expect(p.items.adopt[0].adoptItemId).toBe('manual-1')
    // our unit wins — stock is already recorded against it
    expect(p.items.adopt[0].unit).toBe('Bag')
    expect(p.items.unitConflicts).toEqual([{ name: 'OPC 53 Cement', ours: 'Bag', in4: 'Bags' }])
  })

  it('refuses to adopt when two IN4 names claim the same existing item', () => {
    // Adopting both would hit the one-IN4-name-per-item index and half-fail.
    const have = empty()
    have.byNameKey.set('cement', { id: 'm1', unit: 'Bag' })
    const p = plan([
      line({ material: 'Cement', uom: 'Bag' }),
      line({ material: 'CEMENT', uom: 'Bag' }),
    ], have)
    expect(p.items.adopt).toHaveLength(1)   // collapsed to one IN4 name first
    expect(p.items.create).toHaveLength(0)
  })

  it('reports a unit disagreement instead of changing a locked unit', () => {
    const have = empty()
    have.byIn4Key.set('cement', { id: 'i1', unit: 'Bags' })
    const p = plan([line({ material: 'Cement', uom: 'MT' })], have)
    expect(p.items.unitConflicts).toEqual([{ name: 'Cement', ours: 'Bags', in4: 'MT' }])
    expect(p.items.create).toHaveLength(0)
  })

  it('defaults a missing unit and says which items needed it', () => {
    const p = plan([line({ material: 'Mystery Item', uom: null })], empty())
    expect(p.items.create[0].unit).toBe('Nos')
    expect(p.items.create[0].unitDefaulted).toBe(true)
    expect(p.items.noUom).toEqual(['Mystery Item'])
  })

  it('takes a unit from a later line when the first had none — the PO slot has no UOM', () => {
    const p = plan([
      line({ material: 'Binding Wire', uom: null }),
      line({ material: 'Binding Wire', uom: 'Kgs' }),
    ], empty())
    expect(p.items.create[0].unit).toBe('Kgs')
    expect(p.items.create[0].unitDefaulted).toBe(false)
    expect(p.items.noUom).toEqual([])
  })

  it('counts lines with no material name instead of inventing items', () => {
    const p = plan([
      line({ material: 'Cement' }), line({ material: '' }), line({ material: '---' }),
    ], empty())
    expect(p.items.create).toHaveLength(1)
    expect(p.unnamedLines).toBe(2)
  })
})

describe('units and trades', () => {
  it('adds only the units IN4 actually uses, and only the missing ones', () => {
    const have = empty()
    have.units.add('Nos')
    const p = plan([
      line({ material: 'A', uom: 'Nos' }),
      line({ material: 'B', uom: 'Kgs' }),
    ], have)
    expect(p.units.create).toEqual(['Kgs'])
    expect(p.units.alreadyThere).toBe(1)
  })

  it('flags IN4 using several words for one unit, without merging them', () => {
    const p = plan([
      line({ material: 'A', uom: 'Mtr' }),
      line({ material: 'B', uom: 'Metre' }),
      line({ material: 'C', uom: 'RMT' }),
      line({ material: 'D', uom: 'Nos' }),
    ], empty())
    const metre = p.units.synonymGroups.find(g => g.label === 'metre')!
    expect(metre.members.sort()).toEqual(['Metre', 'Mtr', 'RMT'])
    // one word only is not a clash
    expect(p.units.synonymGroups.find(g => g.label === 'number')).toBeUndefined()
  })

  it('counts an existing unit as part of a synonym clash too', () => {
    const have = empty()
    have.units.add('Pcs')
    const p = plan([line({ material: 'A', uom: 'Nos' })], have)
    expect(p.units.synonymGroups.find(g => g.label === 'number')!.members.sort()).toEqual(['Nos', 'Pcs'])
  })

  it('adds the trades that are missing', () => {
    const have = empty()
    have.disciplines.add('03 Civil')
    const p = plan([
      line({ material: 'A', discipline: '03 Civil' }),
      line({ material: 'B', discipline: '07 Electrical Works' }),
    ], have)
    expect(p.disciplines.create).toEqual(['07 Electrical Works'])
    expect(p.disciplines.alreadyThere).toBe(1)
  })
})

describe('purchase orders', () => {
  it('groups lines onto their PO, with entity from the indent number', () => {
    const p = plan([
      line({ material: 'Cement', indentNo: 'IND/SRASSK/NGH/2024-25/195', project: 'New Guest House',
             pos: [po({ poNo: 'PO-1', qty: 100, rate: 392 })] }),
      line({ material: 'Steel', indentNo: 'IND/SRASSK/NGH/2024-25/196',
             pos: [po({ poNo: 'PO-1', qty: 5, rate: 68000 })] }),
    ], empty())
    expect(p.pos.create).toHaveLength(1)
    const one = p.pos.create[0]
    expect(one.poNo).toBe('PO-1')
    expect(one.entity).toBe('SRASSK')
    expect(one.vendor).toBe('Ultratech')
    expect(one.lines.map(l => l.itemName).sort()).toEqual(['Cement', 'Steel'])
    expect(one.lines.find(l => l.itemName === 'Cement')!.rate).toBe(392)
  })

  it('sums a material repeated once per indent onto one PO line', () => {
    const p = plan([
      line({ material: 'Cement', pos: [po({ poNo: 'PO-1', qty: 100 })] }),
      line({ material: 'Cement', pos: [po({ poNo: 'PO-1', qty: 60 })] }),
    ], empty())
    expect(p.pos.create[0].lines).toHaveLength(1)
    expect(p.pos.create[0].lines[0].qty).toBe(160)
  })

  it('never plans a PO we already imported', () => {
    const have = empty()
    have.poNos.add('PO-1')
    const p = plan([line({ material: 'Cement', pos: [po({ poNo: 'PO-1' })] })], have)
    expect(p.pos.create).toHaveLength(0)
    expect(p.pos.alreadyImported).toBe(1)
  })

  it('skips drafts and inferred POs, and counts them separately', () => {
    const p = plan([
      line({ material: 'A', pos: [po({ poNo: 'DRAFT-PO/X/1' })] }),
      line({ material: 'B', pos: [po({ poNo: 'PO/Y/2', draft: true })] }),
      line({ material: 'C', pos: [po({ poNo: 'PO/Z/3', inferred: true })] }),
      line({ material: 'D', pos: [po({ poNo: 'PO/OK/4' })] }),
    ], empty())
    expect(p.pos.create.map(x => x.poNo)).toEqual(['PO/OK/4'])
    expect(p.pos.skippedDraft).toBe(2)
    expect(p.pos.skippedInferred).toBe(1)
  })

  it('drops a line with no quantity rather than importing a zero', () => {
    const p = plan([
      line({ material: 'A', pos: [po({ poNo: 'PO-1', qty: 0 })] }),
      line({ material: 'B', pos: [po({ poNo: 'PO-1', qty: 10 })] }),
    ], empty())
    expect(p.pos.create[0].lines.map(l => l.itemName)).toEqual(['B'])
  })

  it('matches the project where it can, and names the ones it cannot', () => {
    const have = empty()
    have.projectsByName.set('new guest house', 'proj-1')
    const p = plan([
      line({ material: 'A', project: 'New Guest House', pos: [po({ poNo: 'PO-1' })] }),
      line({ material: 'B', project: 'Mystery Site', pos: [po({ poNo: 'PO-2' })] }),
    ], have)
    expect(p.pos.create.find(x => x.poNo === 'PO-1')!.projectId).toBe('proj-1')
    expect(p.pos.create.find(x => x.poNo === 'PO-2')!.projectId).toBeNull()
    expect(p.pos.unmatchedProjects).toEqual(['Mystery Site'])
  })

  it('counts the priced lines and the items that would get a rate', () => {
    const p = plan([
      line({ material: 'A', pos: [po({ poNo: 'PO-1', rate: 392 })] }),
      line({ material: 'B', pos: [po({ poNo: 'PO-1', rate: null })] }),
      line({ material: 'A', pos: [po({ poNo: 'PO-2', rate: 400 })] }),
    ], empty())
    expect(p.rates.pricedLines).toBe(2)
    expect(p.rates.itemsWithARate).toBe(1)
  })

  it('is empty, not broken, with nothing to sync', () => {
    const p = plan([], empty())
    expect(p.items.create).toEqual([])
    expect(p.pos.create).toEqual([])
    expect(p.unnamedLines).toBe(0)
  })
})

describe('group descriptions', () => {
  it('covers the four groups Aksha picked', () => {
    expect(GROUP_META.map(g => g.key)).toEqual(['items', 'units', 'disciplines', 'pos'])
  })
  it('says of every group what it can and cannot change', () => {
    for (const g of GROUP_META) {
      expect(g.safety.length).toBeGreaterThan(40)
      expect(g.what.length).toBeGreaterThan(15)
    }
  })
})
