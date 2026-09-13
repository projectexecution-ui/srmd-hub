import { describe, it, expect } from 'vitest'
import {
  entryNo, linkedNo, foldStock, availableAt, availableAnywhere, checkIssue,
  outstandingReturnables, missingForGate, missingForComplete, createsStock,
  fmtQty, isPilotProject, PILOT_PROJECT_IDS, type Movement, type ReturnableLine,
} from './core'

const mv = (o: Partial<Movement> & { itemId: string; qty: number }): Movement => ({
  locationId: 'L1', kind: o.qty > 0 ? 'in' : 'out', movedAt: '2026-09-13T04:00:00.000Z', ...o,
})

describe('numbering', () => {
  it('writes the mind map’s own format', () => {
    expect(entryNo('in', '2026-08-15', 1)).toBe('In: 15Aug26/001')
    expect(entryNo('out', '2026-09-13', 42)).toBe('Out: 13Sep26/042')
  })

  it('pads the day as well as the sequence', () => {
    expect(entryNo('in', '2026-01-05', 7)).toBe('In: 05Jan26/007')
  })

  it('does not wrap past 999 — a 1000th entry in one day stays readable', () => {
    expect(entryNo('in', '2026-08-15', 1000)).toBe('In: 15Aug26/1000')
  })

  it('pairs an out with the in it answers', () => {
    expect(linkedNo('Out: 13Sep26/002', 'In: 11Sep26/007')).toBe('Out: 13Sep26/002 (In: 11Sep26/007)')
  })
})

describe('the pilot', () => {
  it('is NGH B and nothing else', () => {
    expect(PILOT_PROJECT_IDS).toHaveLength(1)
    expect(isPilotProject('551a8314-84f7-426a-a0d5-20590830c62e')).toBe(true)
  })

  it('keeps every other project out', () => {
    expect(isPilotProject('768e48c0-6a01-4c95-b406-1ccc8c82a93b')).toBe(false) // SRAH
    expect(isPilotProject('')).toBe(false)
  })
})

describe('folding the ledger into stock', () => {
  it('adds what came in and takes off what went out', () => {
    const s = foldStock([mv({ itemId: 'A', qty: 100 }), mv({ itemId: 'A', qty: -30 })])
    expect(availableAt(s, 'A', 'L1')).toBe(70)
  })

  it('keeps each location separate', () => {
    const s = foldStock([
      mv({ itemId: 'A', qty: 100, locationId: 'L1' }),
      mv({ itemId: 'A', qty: 40, locationId: 'L2' }),
    ])
    expect(availableAt(s, 'A', 'L1')).toBe(100)
    expect(availableAt(s, 'A', 'L2')).toBe(40)
    expect(availableAnywhere(s, 'A')).toBe(140)
  })

  it('keeps a zero row rather than letting a run-out item vanish', () => {
    const s = foldStock([mv({ itemId: 'A', qty: 10 }), mv({ itemId: 'A', qty: -10 })])
    expect(s).toHaveLength(1)
    expect(s[0].qty).toBe(0)
  })

  it('takes the last INBOUND rate, in movement order not array order', () => {
    const s = foldStock([
      mv({ itemId: 'A', qty: 50, rate: 400, movedAt: '2026-09-02T00:00:00.000Z' }),
      mv({ itemId: 'A', qty: 50, rate: 380, movedAt: '2026-08-01T00:00:00.000Z' }),
      mv({ itemId: 'A', qty: -10, rate: 999, movedAt: '2026-09-03T00:00:00.000Z' }),
    ])
    expect(s[0].lastRate).toBe(400)
  })

  it('stops at an as-on date, inclusive to the end of that IST day', () => {
    const rows = [
      mv({ itemId: 'A', qty: 100, movedAt: '2026-09-10T06:00:00.000Z' }),
      mv({ itemId: 'A', qty: -40, movedAt: '2026-09-12T10:00:00.000Z' }),
      mv({ itemId: 'A', qty: -50, movedAt: '2026-09-14T10:00:00.000Z' }),
    ]
    expect(availableAt(foldStock(rows, '2026-09-12'), 'A', 'L1')).toBe(60)
    expect(availableAt(foldStock(rows), 'A', 'L1')).toBe(10)
  })

  it('counts a movement late on the as-on date itself — 23:30 IST is still that day', () => {
    // 18:30Z = 00:00 IST the NEXT day, so 17:00Z is 22:30 IST on the 12th.
    const rows = [mv({ itemId: 'A', qty: 5, movedAt: '2026-09-12T17:00:00.000Z' })]
    expect(availableAt(foldStock(rows, '2026-09-12'), 'A', 'L1')).toBe(5)
  })
})

describe('the only-from-stock rule', () => {
  const stock = foldStock([
    mv({ itemId: 'A', qty: 120, locationId: 'L1' }),
    mv({ itemId: 'B', qty: 400, locationId: 'L2' }),
  ])

  it('allows what is there', () => {
    expect(checkIssue(stock, 'A', 'L1', 120).ok).toBe(true)
  })

  it('refuses more than is there, and says how much there is', () => {
    const r = checkIssue(stock, 'A', 'L1', 121)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('120')
  })

  it('points at the other location rather than just saying no', () => {
    const r = checkIssue(stock, 'B', 'L1', 5)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('another location')
  })

  it('says plainly when nothing exists anywhere', () => {
    const r = checkIssue(stock, 'ZZZ', 'L1', 1)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('gate')
  })

  it('refuses zero and negative quantities', () => {
    expect(checkIssue(stock, 'A', 'L1', 0).ok).toBe(false)
    expect(checkIssue(stock, 'A', 'L1', -5).ok).toBe(false)
  })

  it('always gives a reason when it refuses — no silent blockers', () => {
    for (const [item, loc, qty] of [['A', 'L1', 999], ['B', 'L1', 1], ['ZZ', 'L1', 1], ['A', 'L1', 0]] as const) {
      const r = checkIssue(stock, item, loc, qty)
      expect(r.ok).toBe(false)
      expect(r.reason && r.reason.length).toBeGreaterThan(10)
    }
  })
})

describe('returnables', () => {
  const base = (o: Partial<ReturnableLine>): ReturnableLine => ({
    entryId: 'e1', entryNo: 'In: 01Aug26/001', itemId: 'A', itemName: 'Prop 3.0m', unit: 'Nos',
    qty: 100, heldBy: 'NGH B', owedTo: 'CT Warehouse', since: '2026-09-01T00:00:00.000Z', returned: 0, ...o,
  })
  const today = new Date('2026-09-13T00:00:00.000Z')

  it('shows what is still out, net of what came back', () => {
    const rows = outstandingReturnables([base({ qty: 300, returned: 180 })], today)
    expect(rows[0].outstanding).toBe(120)
  })

  it('drops a line that has fully come back', () => {
    expect(outstandingReturnables([base({ qty: 50, returned: 50 })], today)).toHaveLength(0)
  })

  it('never goes negative if more came back than went out', () => {
    const rows = outstandingReturnables([base({ qty: 10, returned: 25 })], today)
    expect(rows).toHaveLength(0)
  })

  it('puts the oldest debt first', () => {
    const rows = outstandingReturnables([
      base({ itemName: 'Today', since: '2026-09-13T00:00:00.000Z' }),
      base({ itemName: 'July', since: '2026-07-19T00:00:00.000Z' }),
    ], today)
    expect(rows[0].itemName).toBe('July')
    expect(rows[0].days).toBe(56)
  })

  it('holds a vendor debt and a project debt in the same list', () => {
    const rows = outstandingReturnables([
      base({ itemName: 'Cutter', owedTo: 'Shree Balaji (vendor)', since: '2026-07-19T00:00:00.000Z' }),
      base({ itemName: 'Plate', owedTo: 'NGH Infra', since: '2026-08-02T00:00:00.000Z' }),
    ], today)
    expect(rows.map(r => r.owedTo)).toEqual(['Shree Balaji (vendor)', 'NGH Infra'])
  })
})

describe('what an entry still needs', () => {
  it('asks the guard only for what a guard can know', () => {
    expect(missingForGate({ register: 'srm' })).toEqual(['Who is delivering', 'Vehicle number', 'Driver name'])
  })

  it('does not demand a vehicle for hand-delivered material', () => {
    const m = missingForGate({ register: 'srm', partyName: 'Balaji', deliveryModeId: 'hand' })
    expect(m).toEqual([])
  })

  it('asks the storekeeper for the trust, the project, the place and the lines', () => {
    expect(missingForComplete({ register: 'srm' }))
      .toEqual(['Which trust is paying', 'Which project', 'Where it was put', 'At least one item line'])
  })

  it('never asks a VENDOR entry for item lines — site material is not stock', () => {
    const m = missingForComplete({ register: 'vendor', entityId: 'e', projectId: 'p' })
    expect(m).toEqual([])
  })

  it('is satisfied once an SRM entry has all four', () => {
    expect(missingForComplete({ register: 'srm', entityId: 'e', projectId: 'p', locationId: 'l', lineCount: 1 })).toEqual([])
  })
})

describe('which registers create stock', () => {
  it('SRM and transfers do, vendor does not', () => {
    expect(createsStock('srm')).toBe(true)
    expect(createsStock('transfer')).toBe(true)
    expect(createsStock('vendor')).toBe(false)
  })
})

describe('quantity formatting', () => {
  it('drops trailing zeros and groups Indian-style', () => {
    expect(fmtQty(120)).toBe('120')
    expect(fmtQty(4820)).toBe('4,820')
    expect(fmtQty(120000)).toBe('1,20,000')
  })

  it('keeps a real fraction', () => {
    expect(fmtQty(12.5)).toBe('12.5')
  })
})
