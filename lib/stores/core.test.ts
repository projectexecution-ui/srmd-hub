import { describe, it, expect } from 'vitest'
import {
  entryNo, linkedNo, foldStock, availableAt, availableAnywhere, checkIssue,
  outstandingReturnables, checkReturn, missingForGate, missingForComplete, createsStock, heldItemCount,
  fmtQty, isPilotProject, PILOT_PROJECT_IDS, RETURNABLES_ON, groupProjects, UNGROUPED, entityCodeFromOrderNo, categoryFor, isServiceScope, bestIssueLocation,
  type Movement, type ReturnableLine, type StockRow,
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
    lineId: 'l1', entryId: 'e1', entryNo: 'In: 01Aug26/001', itemId: 'A', itemName: 'Prop 3.0m', unit: 'Nos',
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

describe('the Items held tile', () => {
  it('counts ITEMS, not item-and-place rows', () => {
    // The bug it fixes: an item kept in two stores counted twice, so the tile
    // read 728 against an item master of 659 — a number that cannot be true.
    const stock = foldStock([
      mv({ itemId: 'A', qty: 10, locationId: 'L1' }),
      mv({ itemId: 'A', qty: 5, locationId: 'L2' }),
      mv({ itemId: 'B', qty: 3, locationId: 'L1' }),
    ])
    expect(stock).toHaveLength(3)        // three item-and-place rows
    expect(heldItemCount(stock)).toBe(2) // two things held
  })

  it('does not count something that has run out', () => {
    const stock = foldStock([
      mv({ itemId: 'A', qty: 10 }), mv({ itemId: 'A', qty: -10 }),
      mv({ itemId: 'B', qty: 1 }),
    ])
    expect(heldItemCount(stock)).toBe(1)
  })

  it('does not count a negative balance as something held', () => {
    expect(heldItemCount(foldStock([mv({ itemId: 'A', qty: -5 })]))).toBe(0)
  })

  it('is zero on an empty store', () => {
    expect(heldItemCount([])).toBe(0)
  })
})

describe('returning material', () => {
  const rows = outstandingReturnables([
    { lineId: 'props', entryId: 'e1', entryNo: 'In: 05Aug26/001', itemId: 'A', itemName: 'Prop 3.0m',
      unit: 'Nos', qty: 300, heldBy: 'NGH B', owedTo: 'Shah (vendor)', since: '2026-08-05T00:00:00.000Z', returned: 120 },
    { lineId: 'plate', entryId: 'e1', entryNo: 'In: 05Aug26/001', itemId: 'B', itemName: 'Shuttering Plate',
      unit: 'Nos', qty: 50, heldBy: 'NGH B', owedTo: 'Shah (vendor)', since: '2026-08-05T00:00:00.000Z', returned: 0 },
  ], new Date('2026-09-14T00:00:00.000Z'))

  it('settles each line on its own, not the whole entry', () => {
    // Both lines are on ONE gate entry. Returning props must not touch plates.
    expect(rows.find(r => r.lineId === 'props')!.outstanding).toBe(180)
    expect(rows.find(r => r.lineId === 'plate')!.outstanding).toBe(50)
  })

  it('allows a return up to what is still out', () => {
    expect(checkReturn(rows, 'props', 180).ok).toBe(true)
    expect(checkReturn(rows, 'props', 1).ok).toBe(true)
  })

  it('refuses more than is out — giving back too much invents stock', () => {
    const r = checkReturn(rows, 'props', 181)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('180')
    expect(r.reason).toContain('invent')
  })

  it('refuses zero, and a line that is not outstanding', () => {
    expect(checkReturn(rows, 'props', 0).ok).toBe(false)
    expect(checkReturn(rows, 'nope', 5).ok).toBe(false)
  })

  it('always says why it refused', () => {
    for (const [line, qty] of [['props', 999], ['props', 0], ['nope', 1]] as const) {
      const r = checkReturn(rows, line, qty)
      expect(r.ok).toBe(false)
      expect((r.reason ?? '').length).toBeGreaterThan(10)
    }
  })

  it('orders the list the same way twice when two debts are the same age', () => {
    const twice = [0, 1].map(() => outstandingReturnables([
      { lineId: 'b', entryId: 'e', entryNo: 'n', itemId: 'i', itemName: 'Same', unit: 'Nos',
        qty: 5, heldBy: 'p', owedTo: 'o', since: '2026-09-01T00:00:00.000Z', returned: 0 },
      { lineId: 'a', entryId: 'e', entryNo: 'n', itemId: 'i', itemName: 'Same', unit: 'Nos',
        qty: 5, heldBy: 'p', owedTo: 'o', since: '2026-09-01T00:00:00.000Z', returned: 0 },
    ]).map(r => r.lineId))
    expect(twice[0]).toEqual(twice[1])
    expect(twice[0]).toEqual(['a', 'b'])
  })
})

describe('the returnables switch', () => {
  it('is off — Aksha, 14 Sep 2026: "not required now"', () => {
    expect(RETURNABLES_ON).toBe(false)
  })

  it('does not delete the netting logic, so turning it back on shows the truth', () => {
    // The whole point of OFF rather than DELETED: the arithmetic still works,
    // so the list comes back with the real position rather than empty.
    const rows = outstandingReturnables([{
      lineId: 'l', entryId: 'e', entryNo: 'n', itemId: 'i', itemName: 'Prop', unit: 'Nos',
      qty: 100, heldBy: 'NGH B', owedTo: 'Shah', since: '2026-08-01T00:00:00.000Z', returned: 40,
    }], new Date('2026-09-14T00:00:00.000Z'))
    expect(rows[0].outstanding).toBe(60)
    expect(checkReturn(rows, 'l', 61).ok).toBe(false)
  })
})

describe('groupProjects — the picker order', () => {
  const P = (id: string, name: string, parentId: string | null = null) => ({ id, name, parentId })

  it('puts a parent at the head of its own group, children after it by name', () => {
    const out = groupProjects([
      P('c', 'NGH C', 'p'), P('a', 'NGH A', 'p'), P('p', 'NGH'),
    ])
    expect(out.map(o => o.name)).toEqual(['NGH', 'NGH A', 'NGH C'])
    expect(out.every(o => o.group === 'NGH')).toBe(true)
  })

  it('keeps each group contiguous, so one <optgroup> is opened per heading', () => {
    const out = groupProjects([
      P('p2', 'P2'), P('n', 'NGH'), P('p2a', 'P2 A01', 'p2'), P('nb', 'NGH B', 'n'),
    ])
    const seen: string[] = []
    for (const o of out) if (seen[seen.length - 1] !== o.group) seen.push(o.group)
    expect(seen).toEqual([...new Set(seen)])
    expect(seen).toEqual(['NGH', 'P2'])
  })

  it('sends standalone projects to one group at the end', () => {
    const out = groupProjects([
      P('s', 'SRAH'), P('n', 'NGH'), P('nb', 'NGH B', 'n'), P('c', 'CV5'),
    ])
    expect(out.map(o => o.group)).toEqual(['NGH', 'NGH', UNGROUPED, UNGROUPED])
    expect(out.slice(2).map(o => o.name)).toEqual(['CV5', 'SRAH'])
  })

  it('keeps an orphan rather than dropping it — a missing option books material to the wrong site', () => {
    const out = groupProjects([P('x', 'Orphan', 'deleted-parent')])
    expect(out).toEqual([{ id: 'x', name: 'Orphan', group: UNGROUPED }])
  })

  it('never loses or duplicates a project', () => {
    const rows = [
      P('p', 'NGH'), P('a', 'NGH A', 'p'), P('s', 'SRAH'), P('o', 'Orphan', 'gone'),
    ]
    const out = groupProjects(rows)
    expect(out).toHaveLength(rows.length)
    expect(new Set(out.map(o => o.id))).toEqual(new Set(rows.map(r => r.id)))
  })
})

describe('entityCodeFromOrderNo — which trust is paying', () => {
  // The four trusts CT Hub actually holds.
  const OURS = ['SRASSK', 'SRET', 'SRJT', 'SRMD FA']

  it('reads the trust out of a real IN4 order number', () => {
    expect(entityCodeFromOrderNo('PO/SRASSK/AB/2026-27/94', OURS)).toBe('SRASSK')
    expect(entityCodeFromOrderNo('PO/SRJT/SRAH/2026-27/37', OURS)).toBe('SRJT')
  })

  it('finds the trust wherever it sits, not by counting segments', () => {
    // 1,448 of 1,451 orders put it second; three read PO/DO/SRET/RU/…, where
    // "DO" is not a trust at all.
    expect(entityCodeFromOrderNo('PO/DO/SRET/RU/2023-24/1', OURS)).toBe('SRET')
  })

  it('ignores the DRAFT- prefix, which is about status not trust', () => {
    expect(entityCodeFromOrderNo('DRAFT-PO/SRASSK/NGH/2026-27/1445', OURS)).toBe('SRASSK')
  })

  it('gives nothing rather than a guess when no segment is one of ours', () => {
    expect(entityCodeFromOrderNo('123', OURS)).toBeNull()
    expect(entityCodeFromOrderNo('', OURS)).toBeNull()
    expect(entityCodeFromOrderNo('PO/DO/RU/2023-24/1', OURS)).toBeNull()
    expect(entityCodeFromOrderNo('PO/SRASSK/AB/2026-27/94', [])).toBeNull()
  })

  it('matches however the code is spaced or cased', () => {
    expect(entityCodeFromOrderNo('PO/srmdfa/AB/2026-27/1', OURS)).toBe('SRMD FA')
  })
})

describe('categoryFor — the category the screen already knows', () => {
  const CATS = [
    { id: 'v', name: 'Vendor Materials' },
    { id: 'o', name: 'Ordered Items' },
    { id: 'r', name: 'Returnable Items' },
  ]

  it('vendor material is Vendor Materials, order or no order', () => {
    expect(categoryFor('vendor', false, CATS)).toBe('v')
    expect(categoryFor('vendor', true, CATS)).toBe('v')
  })

  it('an order on our own stock makes it Ordered Items', () => {
    expect(categoryFor('srm', true, CATS)).toBe('o')
  })

  it('says nothing rather than guessing when nothing is established', () => {
    expect(categoryFor('srm', false, CATS)).toBeNull()
    expect(categoryFor('transfer', false, CATS)).toBeNull()
  })

  it('survives a renamed or missing category rather than picking the wrong one', () => {
    expect(categoryFor('vendor', false, [{ id: 'o', name: 'Ordered Items' }])).toBeNull()
    expect(categoryFor('srm', true, [])).toBeNull()
  })

  it('matches on the word, so a rename that keeps the word keeps working', () => {
    expect(categoryFor('srm', true, [{ id: 'x', name: 'Ordered / PO items' }])).toBe('x')
  })
})

describe('isServiceScope — what never takes a delivery', () => {
  it('catches the IN4 scopes that are fees rather than things', () => {
    expect(isServiceScope('Raj Uphaar - Professional Consultancy')).toBe(true)
    expect(isServiceScope('SRAH - Professional Consultancy')).toBe(true)
    expect(isServiceScope('New Guest House - Infra Work - Design')).toBe(true)
    expect(isServiceScope('Sheth House - Design')).toBe(true)
    expect(isServiceScope('P2 Row Houses - Design')).toBe(true)
  })

  it('leaves the scopes material actually goes to', () => {
    expect(isServiceScope('Raj Uphaar - Execution')).toBe(false)
    expect(isServiceScope('Staff Facilities Block - Execution')).toBe(false)
    expect(isServiceScope('RU Infra Work')).toBe(false)
    expect(isServiceScope('NGH B')).toBe(false)
    expect(isServiceScope('Warehouse - Execution')).toBe(false)
    expect(isServiceScope('New Guest House - Common Expenses')).toBe(false)
    expect(isServiceScope('Raj Uphaar - Interior Scope')).toBe(false)
  })

  it('does not fire on a word that merely contains one of them', () => {
    // "Designation", "Redesigned Block" — a substring is not a scope.
    expect(isServiceScope('Designation Block')).toBe(false)
    expect(isServiceScope('Designer Tiles Store')).toBe(false)
  })

  it('treats nothing as nothing', () => {
    expect(isServiceScope(null)).toBe(false)
    expect(isServiceScope(undefined)).toBe(false)
    expect(isServiceScope('')).toBe(false)
  })
})

describe('bestIssueLocation — which store to issue out of', () => {
  const s = (itemId: string, locationId: string, qty: number): StockRow =>
    ({ itemId, locationId, qty, lastRate: null })

  const STOCK = [
    s('tile-a', 'yunus', 0),
    s('tile-a', 'ngh', 200),
    s('tile-b', 'ngh', 500),
    s('cable', 'yunus', 90),
  ]

  it('picks the place that can satisfy the whole request', () => {
    expect(bestIssueLocation(STOCK, [
      { itemId: 'tile-a', qty: 16 },
      { itemId: 'tile-b', qty: 140 },
    ])).toBe('ngh')
  })

  it('is exactly the answer to the message the screen already prints', () => {
    // "None here. 200 is held in another location — pick that one."
    expect(bestIssueLocation(STOCK, [{ itemId: 'tile-a', qty: 16 }])).toBe('ngh')
  })

  it('prefers covering the request in full over covering more lines', () => {
    const mixed = [
      s('x', 'partial', 1), s('y', 'partial', 1),   // both, but not enough
      s('x', 'full', 100),                          // one line, in full
    ]
    expect(bestIssueLocation(mixed, [{ itemId: 'x', qty: 10 }, { itemId: 'y', qty: 10 }])).toBe('full')
  })

  it('falls back to the place holding the most when nothing covers it all', () => {
    const thin = [s('x', 'a', 2), s('x', 'b', 7)]
    expect(bestIssueLocation(thin, [{ itemId: 'x', qty: 50 }])).toBe('b')
  })

  it('suggests nothing when nowhere holds any of it', () => {
    expect(bestIssueLocation(STOCK, [{ itemId: 'unknown', qty: 5 }])).toBeNull()
    expect(bestIssueLocation([], [{ itemId: 'tile-a', qty: 5 }])).toBeNull()
  })

  it('ignores lines that are already fully issued', () => {
    expect(bestIssueLocation(STOCK, [{ itemId: 'tile-a', qty: 0 }])).toBeNull()
  })

  it('never suggests a place holding nothing, even at zero rows', () => {
    const zeroed = [s('x', 'empty', 0), s('x', 'has', 5)]
    expect(bestIssueLocation(zeroed, [{ itemId: 'x', qty: 1 }])).toBe('has')
  })
})
