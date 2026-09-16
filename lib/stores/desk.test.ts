import { describe, it, expect } from 'vitest'
import {
  istDay, daysSince, daysOverdue, waitedFor, overdueWord, mostUrgent,
  setupHealth, duplicateNameGroups, checkReceipt, overReceiptNote, receiptLabel,
  searchStock, groupStockByDiscipline, groupStockByStore, stockWorth, itemHistory, moveWord,
  stockLines, NO_DISCIPLINE, type StockLine, type Waiting, type ItemMove,
} from './desk'

const NOW = new Date('2026-09-16T07:30:00.000Z') // 13:00 IST

const line = (o: Partial<StockLine> & { itemId: string; name: string }): StockLine => ({
  unit: 'Nos', locationId: 'L1', where: 'CT Warehouse (Yunus) → Stock',
  site: 'CT Warehouse (Yunus)', spot: 'Stock', qty: 10,
  lastRate: null, value: null, discipline: 'Plumbing', lastMovedAt: null, ...o,
})

describe('days, counted in IST', () => {
  it('reads today as the Indian day, not the UTC one', () => {
    // 19:00 UTC on the 15th is already the 16th in India.
    expect(istDay(new Date('2026-09-15T19:00:00.000Z'))).toBe('2026-09-16')
  })

  it('counts nothing as waiting on the day it arrived', () => {
    expect(daysSince('2026-09-16T05:00:00.000Z', NOW)).toBe(0)
  })

  it('counts whole days waited', () => {
    expect(daysSince('2026-09-13T05:00:00.000Z', NOW)).toBe(3)
  })

  it('is not upset by a missing or unreadable date', () => {
    expect(daysSince(null, NOW)).toBe(0)
    expect(daysSince('not a date', NOW)).toBe(0)
  })

  it('is not overdue on the day it is due, nor before it', () => {
    expect(daysOverdue('2026-09-16', NOW)).toBe(0)
    expect(daysOverdue('2026-09-30', NOW)).toBe(0)
  })

  it('counts the days past a promised date', () => {
    expect(daysOverdue('2026-09-15', NOW)).toBe(1)
    expect(daysOverdue('2026-09-09', NOW)).toBe(7)
  })

  it('says it the way a person says it', () => {
    expect(waitedFor(0)).toBe('today')
    expect(waitedFor(1)).toBe('1 day')
    expect(waitedFor(3)).toBe('3 days')
    expect(overdueWord(0)).toBeNull()
    expect(overdueWord(1)).toBe('yesterday')
    expect(overdueWord(4)).toBe('4 days ago')
  })
})

describe('what is most urgent', () => {
  const req = (o: Partial<Waiting> & { no: string }): Waiting => ({
    kind: 'request', href: '/x', since: '2026-09-16T05:00:00.000Z',
    what: 'something', who: 'Mayank', ...o,
  })

  it('says nothing when nothing is waiting', () => {
    expect(mostUrgent([], NOW)).toBeNull()
  })

  it('puts a broken promise above a long wait', () => {
    const old = req({ no: 'REQ/0001', since: '2026-09-01T05:00:00.000Z' })
    const late = req({ no: 'REQ/0009', dueDay: '2026-09-15' })
    expect(mostUrgent([old, late], NOW)?.no).toBe('REQ/0009')
  })

  it('takes the longest wait when nothing is past its date', () => {
    const a = req({ no: 'REQ/0002', since: '2026-09-13T05:00:00.000Z' })
    const b = req({ no: 'REQ/0003', since: '2026-09-15T05:00:00.000Z' })
    expect(mostUrgent([a, b], NOW)?.no).toBe('REQ/0002')
  })

  it('does not change its mind between two identical rows', () => {
    const a = req({ no: 'REQ/0008' })
    const b = req({ no: 'REQ/0004' })
    expect(mostUrgent([a, b], NOW)?.no).toBe('REQ/0004')
    expect(mostUrgent([b, a], NOW)?.no).toBe('REQ/0004')
  })

  it('writes the whole sentence, so no screen has to', () => {
    const u = mostUrgent([req({
      no: 'REQ/0001', since: '2026-09-12T05:00:00.000Z', dueDay: '2026-09-15',
      what: 'Roff Extrofix, 60 Bags for NGH B',
    })], NOW)
    expect(u?.line).toBe(
      'has been with Mayank for 4 days — Roff Extrofix, 60 Bags for NGH B — it was needed yesterday.')
  })

  it('does not say "for 0 days" about something raised this morning', () => {
    const u = mostUrgent([req({ no: 'REQ/0010' })], NOW)
    expect(u?.line).toContain('since this morning')
    expect(u?.line).not.toContain('0 days')
  })

  it('ranks a waiting vehicle against a waiting request on the same scale', () => {
    const vehicle: Waiting = {
      kind: 'gate', no: 'In: 09Sep26/001', href: '/g', since: '2026-09-09T05:00:00.000Z',
      what: 'Sonal Ceramics', who: 'the storekeeper',
    }
    expect(mostUrgent([req({ no: 'REQ/0002', since: '2026-09-15T05:00:00.000Z' }), vehicle], NOW)?.kind)
      .toBe('gate')
  })
})

describe('setup health', () => {
  const none = {
    itemsWithoutDiscipline: 0, duplicateNameGroups: 0, staffAssigned: 4,
    itemsWithoutRate: 0, locationsWithoutProject: 0,
  }

  it('says nothing when the setup is sound', () => {
    expect(setupHealth(none)).toEqual([])
  })

  it('calls a misrouted approval serious, and a missing rate not', () => {
    const notes = setupHealth({ ...none, itemsWithoutDiscipline: 3, itemsWithoutRate: 596 })
    expect(notes.find(n => n.key === 'discipline')?.serious).toBe(true)
    expect(notes.find(n => n.key === 'rates')?.serious).toBe(false)
  })

  it('flags nobody being assigned, which is what stops an engineer dead', () => {
    expect(setupHealth({ ...none, staffAssigned: 0 }).map(n => n.key)).toContain('staff')
  })

  it('counts one item and many items in the right English', () => {
    expect(setupHealth({ ...none, itemsWithoutDiscipline: 1 })[0].text).toContain('1 item without')
    expect(setupHealth({ ...none, itemsWithoutDiscipline: 3 })[0].text).toContain('3 items without')
  })

  it('leads with what is broken, not with what is untidy', () => {
    const notes = setupHealth({
      itemsWithoutDiscipline: 3, duplicateNameGroups: 7, staffAssigned: 0,
      itemsWithoutRate: 596, locationsWithoutProject: 3,
    })
    expect(notes.slice(0, 3).every(n => n.serious)).toBe(true)
    expect(notes.slice(3).every(n => !n.serious)).toBe(true)
  })
})

describe('items spelled two ways', () => {
  it('finds the pairs that split one item’s stock', () => {
    const groups = duplicateNameGroups([
      { id: '1', name: 'MCB 16A  1P' },
      { id: '2', name: 'MCB 16A 1P' },
      { id: '3', name: '40 x 32 mm CPVC BUSHING' },
      { id: '4', name: '40 x 32MM CPVC BUSHING' },
      { id: '5', name: 'Roff Extrofix' },
    ])
    expect(groups).toHaveLength(2)
    expect(groups.flatMap(g => g.items.map(i => i.id)).sort()).toEqual(['1', '2', '3', '4'])
  })

  it('does not call two genuinely different items a duplicate', () => {
    expect(duplicateNameGroups([
      { id: '1', name: 'MCB 16A 1P' },
      { id: '2', name: 'MCB 32A 2P' },
    ])).toEqual([])
  })

  it('puts the worst split first', () => {
    const groups = duplicateNameGroups([
      { id: '1', name: '3C x 2.5 SQMM' }, { id: '2', name: '3Cx2.5 SQMM' }, { id: '3', name: '3C x2.5 sqmm' },
      { id: '4', name: 'PVC TEE' }, { id: '5', name: 'pvc  tee' },
    ])
    expect(groups[0].items).toHaveLength(3)
  })
})

describe('counting a delivery in against its order', () => {
  it('does not add IN4’s receipts to our own — they are the same lorries', () => {
    // IN4 has booked 4,000; the gate has counted 10,000 of the same deliveries.
    const c = checkReceipt({ ordered: 33_142, alreadyIn: 4_000, atGate: 10_000 })
    expect(c.received).toBe(10_000)
    expect(c.from).toBe('gate')
    expect(c.outstanding).toBe(23_142)
  })

  it('takes IN4’s figure when IN4 knows more', () => {
    const c = checkReceipt({ ordered: 100, alreadyIn: 80, atGate: 10 })
    expect(c.received).toBe(80)
    expect(c.from).toBe('in4')
  })

  it('says so when the two agree', () => {
    expect(checkReceipt({ ordered: 100, alreadyIn: 40, atGate: 40 }).from).toBe('agreed')
    expect(checkReceipt({ ordered: 100, alreadyIn: 0, atGate: 0 }).from).toBe('none')
  })

  it('stops the second delivery pre-filling the whole order again', () => {
    // 16 Sep 2026: In:…/001 counted 20,088 in, IN4's GRN had not moved, and the
    // form offered the full order a second time on In:…/002.
    const first = checkReceipt({ ordered: 20_088, alreadyIn: 0, atGate: 0 })
    expect(first.outstanding).toBe(20_088)
    const second = checkReceipt({ ordered: 20_088, alreadyIn: 0, atGate: 20_088 })
    expect(second.outstanding).toBe(0)
  })

  it('works out how far past the order a quantity would go', () => {
    const c = checkReceipt({ ordered: 33_142, alreadyIn: 0, atGate: 22_475 }, 12_387)
    expect(c.total).toBe(34_862)
    expect(c.over).toBe(1_720)
  })

  it('says nothing at all while the delivery is within the order', () => {
    expect(overReceiptNote({ ordered: 100, alreadyIn: 0, atGate: 40 }, 60)).toBeNull()
    expect(overReceiptNote({ ordered: 100, alreadyIn: 0, atGate: 0 }, 0)).toBeNull()
  })

  it('says it in figures a storekeeper can check against the challan', () => {
    const note = overReceiptNote({ ordered: 33_142, alreadyIn: 0, atGate: 22_475 }, 12_387, 'SqFt')
    expect(note).toContain('34,862 SqFt')
    expect(note).toContain('33,142 SqFt ordered')
    expect(note).toContain('1,720 SqFt over')
  })

  it('never blocks the save — it marks it', () => {
    expect(overReceiptNote({ ordered: 10, alreadyIn: 0, atGate: 0 }, 99)).toContain('still save')
  })

  it('treats a missing figure as nothing rather than as NaN', () => {
    const c = checkReceipt({ ordered: 100, alreadyIn: NaN, atGate: NaN })
    expect(c.received).toBe(0)
    expect(c.outstanding).toBe(100)
  })
})

describe('the stock list', () => {
  const rows: StockLine[] = [
    line({ itemId: 'a', name: '110mm PVC TEE', qty: 381, lastRate: 98.04, value: 98.04 * 381 }),
    line({ itemId: 'b', name: '110mm PVC END CAP', qty: 766, where: 'NGH A → Stock' }),
    line({ itemId: 'c', name: 'Roff Extrofix', discipline: 'Finishes', qty: 320, lastRate: 760, value: 760 * 320 }),
    line({ itemId: 'd', name: 'DOOR EYE', discipline: null, qty: 4 }),
    line({ itemId: 'a', name: '110mm PVC TEE', qty: 100, where: 'NGH A → Stock', locationId: 'L2' }),
  ]

  it('finds an item on a few letters of its name', () => {
    expect(searchStock(rows, 'tee').map(r => r.itemId)).toEqual(['a', 'a'])
  })

  it('matches every word, anywhere in the row', () => {
    expect(searchStock(rows, 'pvc ngh').map(r => r.name)).toEqual(['110mm PVC END CAP', '110mm PVC TEE'])
  })

  it('ignores case and returns everything for an empty search', () => {
    expect(searchStock(rows, '  ')).toHaveLength(rows.length)
    expect(searchStock(rows, 'ROFF')).toHaveLength(1)
  })

  it('counts items, not rows — one item on two shelves is one item', () => {
    const plumbing = groupStockByDiscipline(rows).find(g => g.label === 'Plumbing')!
    expect(plumbing.rows).toHaveLength(3)
    expect(plumbing.items).toBe(2)
  })

  it('leads with what the store mostly holds', () => {
    expect(groupStockByDiscipline(rows)[0].label).toBe('Plumbing')
  })

  it('sinks the items with no discipline to the bottom, however many there are', () => {
    const many = [...rows, line({ itemId: 'e', name: 'X', discipline: null }), line({ itemId: 'f', name: 'Y', discipline: null })]
    const groups = groupStockByDiscipline(many)
    expect(groups[groups.length - 1].label).toBe(NO_DISCIPLINE)
  })

  it('says a group’s value understates when something in it has no rate', () => {
    const groups = groupStockByDiscipline(rows)
    expect(groups.find(g => g.label === 'Plumbing')?.unpriced).toBe(true)
    expect(groups.find(g => g.label === 'Finishes')?.unpriced).toBe(false)
  })

  it('never turns a missing rate into a zero', () => {
    const w = stockWorth(rows)
    expect(w.value).toBeCloseTo(98.04 * 381 + 760 * 320, 2)
    expect(w.unpriced).toBe(3)
  })

  it('builds its lines from the fold, so nothing is rounded twice', () => {
    const built = stockLines(
      [{ itemId: 'a', locationId: 'L1', qty: 381, lastRate: 98.04, lastMovedAt: '2026-08-26T00:00:00.000Z' }],
      {
        name: () => '110mm PVC TEE', unit: () => 'Units', discipline: () => 'Plumbing',
        where: () => 'NGH A → Stock', site: () => 'NGH A',
      },
    )
    expect(built[0].value).toBeCloseTo(98.04 * 381, 6)
    expect(built[0].lastMovedAt).toBe('2026-08-26T00:00:00.000Z')
  })

  it('leaves value null, not zero, when the fold found no rate', () => {
    const built = stockLines([{ itemId: 'a', locationId: null, qty: 5, lastRate: null, lastMovedAt: null }], {
      name: () => 'X', unit: () => 'Nos', discipline: () => null, where: () => 'Not placed',
    })
    expect(built[0].value).toBeNull()
  })
})

describe('one item’s history', () => {
  const mv = (o: Partial<ItemMove> & { id: string; qty: number; movedAt: string }): ItemMove => ({
    kind: o.qty > 0 ? 'in' : 'out', rate: null, entryId: null, entryNo: null,
    party: null, project: null, place: null, who: null, note: null, ...o,
  })

  it('reads newest first, with the balance as it stood after each movement', () => {
    const rows = itemHistory([
      mv({ id: '1', qty: 140, movedAt: '2026-09-15T03:19:00.000Z' }),
      mv({ id: '2', qty: 140, movedAt: '2026-09-15T04:10:00.000Z' }),
      mv({ id: '3', qty: -140, movedAt: '2026-09-15T14:53:00.000Z' }),
    ])
    expect(rows.map(r => r.id)).toEqual(['3', '2', '1'])
    expect(rows.map(r => r.balance)).toEqual([140, 280, 140])
  })

  it('ends at the same number the stock screen shows', () => {
    const rows = itemHistory([
      mv({ id: '1', qty: 320, movedAt: '2026-08-26T00:00:00.000Z', kind: 'opening' }),
      mv({ id: '2', qty: -10, movedAt: '2026-09-11T11:55:00.000Z' }),
    ])
    expect(rows[0].balance).toBe(310)
  })

  it('does not depend on the order the rows came back from the database', () => {
    const a = itemHistory([
      mv({ id: '2', qty: -10, movedAt: '2026-09-11T11:55:00.000Z' }),
      mv({ id: '1', qty: 320, movedAt: '2026-08-26T00:00:00.000Z', kind: 'opening' }),
    ])
    expect(a.map(r => r.balance)).toEqual([310, 320])
  })

  it('calls a correction what it is, in either direction', () => {
    expect(moveWord('opening', 320)).toBe('Opening')
    expect(moveWord('adjust', -6)).toBe('Corrected down')
    expect(moveWord('adjust', 2)).toBe('Corrected up')
    expect(moveWord('in', 140)).toBe('In')
    expect(moveWord('out', -140)).toBe('Out')
  })

  it('is empty, not broken, for an item that has never moved', () => {
    expect(itemHistory([])).toEqual([])
  })
})

describe('the same lines, grouped by the place they are in', () => {
  const at = (itemId: string, name: string, locationId: string, where: string, qty: number, value: number | null = null) =>
    line({
      itemId, name, locationId, where, qty, value,
      site: where.split(' → ')[0], spot: where.split(' → ')[1] ?? where,
    })

  const rows = [
    at('a', 'Roff Extrofix', 'L1', 'CT Warehouse (Yunus) → Container 1', 320, 243_200),
    at('b', 'PVC TEE', 'L1', 'CT Warehouse (Yunus) → Container 1', 40),
    at('a', 'Roff Extrofix', 'L2', 'CT Warehouse (Yunus) → Stock', 10, 7_600),
    at('c', 'Simero Ferro White', 'L3', 'NGH B → Warehouse-NGH', 4_774, 250_635),
  ]

  it('gives one group per place, not per site', () => {
    expect(groupStockByStore(rows).map(g => g.label)).toEqual([
      'CT Warehouse (Yunus) → Container 1',
      'CT Warehouse (Yunus) → Stock',
      'NGH B → Warehouse-NGH',
    ])
  })

  it('bands by site, in the order a person says the place', () => {
    expect(groupStockByStore(rows).map(g => g.site)).toEqual([
      'CT Warehouse (Yunus)', 'CT Warehouse (Yunus)', 'NGH B',
    ])
    expect(groupStockByStore(rows)[0].spot).toBe('Container 1')
  })

  it('leaves out what is not there — a zero balance is not in a store', () => {
    const withZero = [...rows, at('d', 'Gone', 'L1', 'CT Warehouse (Yunus) → Container 1', 0)]
    expect(groupStockByStore(withZero).find(g => g.label.endsWith('Container 1'))?.rows).toHaveLength(2)
  })

  it('says a place’s value understates when something in it has no rate', () => {
    const g = groupStockByStore(rows)
    expect(g[0].unpriced).toBe(true)
    expect(g[2].unpriced).toBe(false)
    expect(g[2].value).toBe(250_635)
  })

  it('agrees with the item view about every quantity, because it is the same list', () => {
    const byItem = groupStockByDiscipline(rows).flatMap(g => g.rows)
    const byStore = groupStockByStore(rows).flatMap(g => g.rows)
    const total = (rs: typeof rows) => rs.reduce((s, r) => s + r.qty, 0)
    expect(total(byStore)).toBe(total(byItem.filter(r => r.qty > 0 && r.locationId)))
  })
})

describe('the over-receipt warning does not cry wolf', () => {
  // Aksha's screenshot, 16 Sep 2026: a line sitting at a quantity of ZERO was
  // being told it had made 5,364 against 2,682 ordered. Two of his own test
  // entries had already double-counted that line; the storekeeper standing at
  // the next lorry did not do it and cannot fix it by typing a smaller number.
  const doubled = { ordered: 2_682, alreadyIn: 0, atGate: 5_364 }

  it('says nothing at all while nothing is being added', () => {
    expect(overReceiptNote(doubled, 0, 'SqFt')).toBeNull()
    expect(overReceiptNote(doubled, NaN, 'SqFt')).toBeNull()
    expect(overReceiptNote(doubled, -5, 'SqFt')).toBeNull()
  })

  it('blames the earlier entries, not this lorry, when it was over already', () => {
    const note = overReceiptNote(doubled, 100, 'SqFt')
    expect(note).toContain('5,364 SqFt was already counted in')
    expect(note).toContain('2,682 SqFt over before this lorry')
    expect(note).toContain('Check the earlier entries')
    // It must NOT say this delivery "makes" the total — it did not.
    expect(note).not.toContain('This makes')
  })

  it('still blames this delivery when this delivery is what tips it over', () => {
    const note = overReceiptNote({ ordered: 100, alreadyIn: 0, atGate: 40 }, 80, 'Nos')
    expect(note).toContain('This makes 120 Nos against 100 Nos ordered')
    expect(note).toContain('20 Nos over')
    expect(note).toContain('still save')
  })

  it('says where the "already in" figure came from, and when it is over', () => {
    expect(receiptLabel(doubled, 'SqFt'))
      .toBe('Ordered 2,682 SqFt · 5,364 already in (counted at the gate) · already 2,682 over')
    expect(receiptLabel({ ordered: 100, alreadyIn: 80, atGate: 0 }, 'Nos'))
      .toBe('Ordered 100 Nos · 80 already in (IN4)')
    expect(receiptLabel({ ordered: 100, alreadyIn: 0, atGate: 0 }, 'Nos'))
      .toBe('Ordered 100 Nos · 0 already in')
  })
})
