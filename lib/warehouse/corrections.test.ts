import { describe, expect, it } from 'vitest'
import {
  reverse, reversalOf, stockDelta, damagedDelta, voidBlocker,
  codeFrom, uniqueCode, namingBlocker, retireBlocker, deleteStoreBlocker,
  outstandingOf, returnBlocker,
  unitChangeBlocker, retireItemBlocker, mergeBlocker, mergePreview,
} from './corrections'
import type { PostedMovement, OnHand, ItemFacts, ReturnableOutLine, RetireStoreFacts } from './corrections'
import { foldLedger } from './ledger'
import type { LedgerRow } from './ledger'

const mv = (o: Partial<PostedMovement> & { kind: PostedMovement['kind']; qty: number }): PostedMovement => ({
  itemId: 'cement', locationId: 'A', rate: 392, ...o,
})

// ===========================================================================
// Voiding
// ===========================================================================
describe('reversing a voided entry', () => {
  it('undoes a receipt by taking the same quantity back out', () => {
    expect(reverse(mv({ kind: 'in', qty: 100 }))).toMatchObject({ kind: 'void', qty: -100 })
  })

  it('undoes an issue by putting it back', () => {
    expect(reverse(mv({ kind: 'issue', qty: 40 }))).toMatchObject({ kind: 'void', qty: 40 })
  })

  it('undoes both ends of a store move, in opposite directions', () => {
    const out = reverse(mv({ kind: 'move_out', qty: 25, locationId: 'A' }))
    const into = reverse(mv({ kind: 'move_in', qty: 25, locationId: 'B' }))
    expect(out).toMatchObject({ locationId: 'A', qty: 25 })
    expect(into).toMatchObject({ locationId: 'B', qty: -25 })
  })

  it('undoes damage as negative damage, not as a void', () => {
    // stockEffect('damage') is 0, so inverting it would post nothing at all and
    // the damaged bucket would keep a quantity that never arrived.
    expect(reverse(mv({ kind: 'damage', qty: 5 }))).toMatchObject({ kind: 'damage', qty: -5 })
  })

  it('leaves good stock alone when it reverses damage', () => {
    const r = reversalOf([mv({ kind: 'damage', qty: 5 })])
    expect([...stockDelta(r).values()]).toEqual([])
    expect(damagedDelta(r).get('cement|A')).toBe(-5)
  })

  it('drops reversals that would move nothing', () => {
    expect(reversalOf([mv({ kind: 'in', qty: 0 })])).toHaveLength(0)
  })

  it('nets the ledger back to where it started', () => {
    // The real proof: post an entry, post its reversal, fold the whole ledger
    // and the store is exactly where it was before the entry existed.
    const posted: PostedMovement[] = [
      mv({ kind: 'in', qty: 95 }),
      mv({ kind: 'damage', qty: 5 }),
    ]
    const rows: LedgerRow[] = [
      ...posted.map(m => ({ ...m, day: '2026-08-16' })),
      ...reversalOf(posted).map(m => ({ ...m, day: '2026-08-16' })),
    ]
    const [cell] = foldLedger(rows)
    expect(cell.inHand).toBe(0)
    expect(cell.damagedQty).toBe(0)
  })
})

describe('when a void is refused', () => {
  const target = { entryNo: 'In: 16Aug26/003', alreadyVoided: false }
  const reason = 'Wrong store — it went to Yunus, not NGH'
  const onHand: OnHand = new Map([
    ['cement|A', { qty: 100, itemName: 'OPC 53 Cement', unit: 'Bag', storeName: 'NGH Open Area' }],
  ])

  it('lets a clean void through', () => {
    const r = reversalOf([mv({ kind: 'in', qty: 100 })])
    expect(voidBlocker(target, reason, r, onHand)).toBeNull()
  })

  it('refuses a second void of the same entry', () => {
    expect(voidBlocker({ ...target, alreadyVoided: true }, reason, [], onHand))
      .toContain('already voided')
  })

  it('insists on a reason worth reading', () => {
    expect(voidBlocker(target, 'oops', [], onHand)).toContain('Say why')
    expect(voidBlocker(target, '          ', [], onHand)).toContain('Say why')
  })

  it('refuses when the material has already been issued onward', () => {
    // 120 came in, 100 is left — 20 went to site. Undoing the receipt would
    // leave the store holding minus 20.
    const r = reversalOf([mv({ kind: 'in', qty: 120 })])
    const msg = voidBlocker(target, reason, r, onHand)
    expect(msg).toContain('less than nothing')
    expect(msg).toContain('OPC 53 Cement')
    expect(msg).toContain('physical count')
  })

  it('allows a void that empties the store exactly', () => {
    const r = reversalOf([mv({ kind: 'in', qty: 100 })])
    expect(voidBlocker(target, reason, r, onHand)).toBeNull()
  })

  it('never refuses a void that puts stock back', () => {
    const r = reversalOf([mv({ kind: 'issue', qty: 10_000 })])
    expect(voidBlocker(target, reason, r, onHand)).toBeNull()
  })

  it('checks the receiving store when a move is undone', () => {
    // The move put 60 into B; B has since issued 50 of them.
    const r = reversalOf([
      mv({ kind: 'move_out', qty: 60, locationId: 'A' }),
      mv({ kind: 'move_in', qty: 60, locationId: 'B' }),
    ])
    const hand: OnHand = new Map([
      ['cement|A', { qty: 0, itemName: 'OPC 53 Cement', unit: 'Bag', storeName: 'NGH Open Area' }],
      ['cement|B', { qty: 10, itemName: 'OPC 53 Cement', unit: 'Bag', storeName: 'Yunus Land Store' }],
    ])
    expect(voidBlocker(target, reason, r, hand)).toContain('Yunus Land Store')
  })

  it('treats a store it has never heard of as holding nothing', () => {
    const r = reversalOf([mv({ kind: 'in', qty: 1, locationId: 'ZZ' })])
    expect(voidBlocker(target, reason, r, onHand)).toContain('less than nothing')
  })
})

// ===========================================================================
// Stores and sites
// ===========================================================================
describe('naming a store', () => {
  it('builds a code that reads like the name', () => {
    expect(codeFrom('Yunus Land Store')).toBe('YUNUS-LAND-STORE')
    expect(codeFrom('  NGH — Open Area!  ')).toBe('NGH-OPEN-AREA')
  })

  it('never collides, including with retired stores', () => {
    expect(uniqueCode('Main Store', ['MAIN-STORE'])).toBe('MAIN-STORE-2')
    expect(uniqueCode('Main Store', ['MAIN-STORE', 'MAIN-STORE-2'])).toBe('MAIN-STORE-3')
  })

  it('survives a name with nothing usable in it', () => {
    expect(uniqueCode('!!!', [])).toBe('STORE')
  })

  it('refuses a duplicate name in the same site', () => {
    expect(namingBlocker('Open Area', ['Open Area', 'Godown'])).toContain('already')
    expect(namingBlocker('Open Area', ['Godown'])).toBeNull()
  })

  it('lets a rename keep its own name', () => {
    expect(namingBlocker('Open Area', ['Open Area', 'Godown'], 'Open Area')).toBeNull()
  })

  it('wants a real name', () => {
    expect(namingBlocker('A', [])).toContain('two characters')
  })
})

describe('retiring a store', () => {
  const f = (o: Partial<RetireStoreFacts> = {}): RetireStoreFacts => ({
    storeName: 'Yunus Land Store', stockLines: 0, stockQty: 0, entries: 0, childStores: 0, ...o,
  })

  it('allows retiring an empty store, however long its history', () => {
    expect(retireBlocker(f({ entries: 900 }))).toBeNull()
  })

  it('refuses while material is still in it', () => {
    expect(retireBlocker(f({ stockLines: 3, stockQty: 412 }))).toContain('hide the material')
  })

  it('refuses a site that still has stores under it, and says so first', () => {
    const msg = retireBlocker(f({ childStores: 2, stockLines: 1 }))
    expect(msg).toContain('under it')
  })

  it('explains why a store with history cannot be deleted outright', () => {
    expect(deleteStoreBlocker(f({ entries: 12 }))).toContain('retired')
  })

  it('lets a never-used store be deleted', () => {
    expect(deleteStoreBlocker(f())).toBeNull()
  })
})

// ===========================================================================
// Returns
// ===========================================================================
describe('recording a return', () => {
  const line: ReturnableOutLine = {
    lineId: 'l1', itemId: 'plate', itemName: 'Shuttering Plate 3x2', unit: 'Nos',
    qty: 200, returnedQty: 50,
  }

  it('knows what is still out', () => {
    expect(outstandingOf(line)).toBe(150)
    expect(outstandingOf({ ...line, returnedQty: 200 })).toBe(0)
    expect(outstandingOf({ ...line, returnedQty: 250 })).toBe(0)
  })

  it('accepts a partial return', () => {
    expect(returnBlocker(line, 80, true)).toBeNull()
  })

  it('accepts the exact outstanding quantity', () => {
    expect(returnBlocker(line, 150, true)).toBeNull()
  })

  it('refuses more than went out, and says where the extra belongs', () => {
    const msg = returnBlocker(line, 151, true)
    expect(msg).toContain('150 Nos')
    expect(msg).toContain('gate')
  })

  it('refuses a line that is already fully back', () => {
    expect(returnBlocker({ ...line, returnedQty: 200 }, 1, true)).toContain('already back')
  })

  it('refuses an issue that was never returnable', () => {
    expect(returnBlocker(line, 10, false)).toContain('not marked returnable')
  })

  it('wants a quantity', () => {
    expect(returnBlocker(line, 0, true)).toContain('how much')
    expect(returnBlocker(line, -5, true)).toContain('how much')
  })
})

// ===========================================================================
// The item master
// ===========================================================================
describe('the item master', () => {
  const f = (o: Partial<ItemFacts> = {}): ItemFacts => ({
    itemId: 'i1', name: 'OPC 53 Cement', unit: 'Bag',
    movements: 0, stockLines: 0, stockQty: 0, openPoLines: 0, ...o,
  })

  it('lets the unit be fixed on an item nothing has touched', () => {
    expect(unitChangeBlocker(f(), 'Kg')).toBeNull()
  })

  it('refuses to change the unit once quantities exist in it', () => {
    const msg = unitChangeBlocker(f({ movements: 14 }), 'Kg')
    expect(msg).toContain('reinterpret')
    expect(msg).toContain('merge')
  })

  it('does not object to setting the unit it already has', () => {
    expect(unitChangeBlocker(f({ movements: 14 }), 'Bag')).toBeNull()
  })

  it('refuses to retire an item that still has stock', () => {
    expect(retireItemBlocker(f({ stockLines: 1, stockQty: 40 }))).toContain('40 Bag')
  })

  it('refuses to retire an item still on an open PO', () => {
    expect(retireItemBlocker(f({ openPoLines: 2 }))).toContain('open PO')
  })

  it('retires a spent item with history', () => {
    expect(retireItemBlocker(f({ movements: 200 }))).toBeNull()
  })

  it('refuses a merge across different units', () => {
    const msg = mergeBlocker({ from: f({ itemId: 'a', unit: 'Kg' }), into: f({ itemId: 'b', unit: 'Bag' }) })
    expect(msg).toContain('not the same thing')
  })

  it('refuses to merge an item into itself', () => {
    expect(mergeBlocker({ from: f(), into: f() })).toContain('into itself')
  })

  it('allows a same-unit merge', () => {
    expect(mergeBlocker({ from: f({ itemId: 'a' }), into: f({ itemId: 'b' }) })).toBeNull()
  })

  it('spells out what the merge will do before it is confirmed', () => {
    const preview = mergePreview({
      from: f({ itemId: 'a', name: 'Cement OPC53', stockLines: 2, stockQty: 300, openPoLines: 1 }),
      into: f({ itemId: 'b', name: 'OPC 53 Cement' }),
    })
    expect(preview.join(' ')).toContain('300 Bag')
    expect(preview.join(' ')).toContain('1 open PO line')
    expect(preview.join(' ')).toContain('cannot be undone')
  })
})
