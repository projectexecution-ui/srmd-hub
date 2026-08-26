import { describe, expect, it } from 'vitest'
import {
  estimateValue, raiseBlocker, shortfalls, issuableBlocker,
  outstanding, statusAfterIssue, fulfilledPct, isOpen, ageDays, isStale,
  STALE_REQUEST_DAYS, STATUS_LABEL,
  foldStock, passPending, requestClosed, passLabel,
} from './requests'
import type { RaiseInput, RequestState, RequestStatus, Handover } from './requests'

// ===========================================================================
// What a request is worth
// ===========================================================================
describe('what a request is worth', () => {
  it('adds up the priced lines', () => {
    expect(estimateValue([{ qty: 10, lastRate: 392 }, { qty: 2, lastRate: 100 }]))
      .toEqual({ value: 4120, partial: false })
  })

  it('flags itself as partial rather than counting an unpriced line as free', () => {
    const e = estimateValue([{ qty: 10, lastRate: 392 }, { qty: 500, lastRate: null }])
    expect(e.value).toBe(3920)
    expect(e.partial).toBe(true)
  })
})

// ===========================================================================
// Raising
// ===========================================================================
describe('raising a request', () => {
  const good = (o: Partial<RaiseInput> = {}): RaiseInput => ({
    fromLocationId: 'A', toLocationId: null, projectId: 'p1',
    purpose: 'Slab shuttering at NGH B', needBy: '2026-08-20',
    lines: [{ itemId: 'cement', qty: 100 }],
    ...o,
  })

  it('lets a complete request through', () => {
    expect(raiseBlocker(good(), '2026-08-17')).toBeNull()
  })

  it('does NOT need a store — the keeper decides that', () => {
    // Aksha's rule: an engineer says what he needs, not which of nine stores
    // happens to hold it. Naming no store is the normal case, not an error.
    expect(raiseBlocker(good({ fromLocationId: null }), '2026-08-17')).toBeNull()
  })

  it('still refuses a transfer to the same store it is asking, when one is named', () => {
    expect(raiseBlocker(good({ toLocationId: 'A' }), '2026-08-17')).toContain('nothing would move')
  })

  it('does not trip that check when no source store was named', () => {
    // Null source vs a named destination is a perfectly ordinary transfer ask.
    expect(raiseBlocker(good({ fromLocationId: null, toLocationId: 'B' }), '2026-08-17')).toBeNull()
  })

  it('insists on a purpose the keeper can act on', () => {
    expect(raiseBlocker(good({ purpose: 'x' }), '2026-08-17')).toContain('what it is for')
  })

  it('needs at least one item with a quantity', () => {
    expect(raiseBlocker(good({ lines: [] }), '2026-08-17')).toContain('at least one item')
    expect(raiseBlocker(good({ lines: [{ itemId: 'cement', qty: 0 }] }), '2026-08-17'))
      .toContain('at least one item')
  })

  it('refuses the same item twice instead of guessing which quantity is meant', () => {
    const b = raiseBlocker(good({
      lines: [{ itemId: 'cement', qty: 10 }, { itemId: 'cement', qty: 5 }],
    }), '2026-08-17')
    expect(b).toContain('twice')
  })

  it('refuses a needed-by date in the past', () => {
    expect(raiseBlocker(good({ needBy: '2026-08-01' }), '2026-08-17')).toContain('in the past')
  })

  it('accepts today as the needed-by date', () => {
    expect(raiseBlocker(good({ needBy: '2026-08-17' }), '2026-08-17')).toBeNull()
  })
})

describe('warning about stock before submitting', () => {
  const onHand = new Map([
    ['cement', { qty: 40, itemName: 'OPC 53 Cement', unit: 'Bag' }],
  ])

  it('names what is short and by how much', () => {
    const s = shortfalls([{ itemId: 'cement', qty: 100 }], onHand)
    expect(s).toEqual([{ itemName: 'OPC 53 Cement', wanted: 100, available: 40, unit: 'Bag' }])
  })

  it('says nothing when the store has enough', () => {
    expect(shortfalls([{ itemId: 'cement', qty: 40 }], onHand)).toHaveLength(0)
  })

  it('treats an item the store has never held as zero, not as unknown', () => {
    const s = shortfalls([{ itemId: 'wire', qty: 5 }], onHand)
    expect(s[0].available).toBe(0)
  })
})

describe('issuing against a request', () => {
  const st = (o: Partial<RequestState> = {}): RequestState => ({
    reqNo: 'Rq: 17Aug26/001', status: 'approved',
    stagesNeeded: 1, stagesDone: 1, requestedBy: 'eng', approvers: ['head1'],
    ...o,
  })

  it('allows it once approved', () => {
    expect(issuableBlocker(st())).toBeNull()
  })

  it('blocks it anywhere in the approval chain', () => {
    expect(issuableBlocker(st({ status: 'pending' }))).toContain('approval chain')
    expect(issuableBlocker(st({ status: 'checked' }))).toContain('approval chain')
  })

  it('blocks a rejected, cancelled or finished request', () => {
    expect(issuableBlocker(st({ status: 'rejected' }))).toContain('rejected')
    expect(issuableBlocker(st({ status: 'cancelled' }))).toContain('cancelled')
    expect(issuableBlocker(st({ status: 'issued' }))).toContain('fully issued')
  })

  it('allows more against a part-issued request', () => {
    expect(issuableBlocker(st({ status: 'part_issued' }))).toBeNull()
  })
})

describe('how far along a request is', () => {
  it('knows what is still outstanding, and never goes negative on an over-issue', () => {
    expect(outstanding({ qty: 100, issuedQty: 40 })).toBe(60)
    expect(outstanding({ qty: 100, issuedQty: 120 })).toBe(0)
  })

  it('reads part issued until every line is complete', () => {
    expect(statusAfterIssue([{ qty: 100, issuedQty: 40 }])).toBe('part_issued')
    expect(statusAfterIssue([{ qty: 100, issuedQty: 100 }])).toBe('issued')
    expect(statusAfterIssue([
      { qty: 100, issuedQty: 100 }, { qty: 5, issuedQty: 0 },
    ])).toBe('part_issued')
  })

  it('falls back to approved when an issue moved nothing', () => {
    expect(statusAfterIssue([{ qty: 100, issuedQty: 0 }])).toBe('approved')
  })

  it('caps the percentage at 100 even if more went out than was asked', () => {
    expect(fulfilledPct([{ qty: 100, issuedQty: 50 }])).toBe(50)
    expect(fulfilledPct([{ qty: 100, issuedQty: 250 }])).toBe(100)
    expect(fulfilledPct([])).toBe(0)
  })
})

describe('ageing and chasing', () => {
  it('counts days waited', () => {
    expect(ageDays('2026-08-14', '2026-08-17')).toBe(3)
    expect(ageDays('2026-08-17', '2026-08-17')).toBe(0)
  })

  it('never reports a negative age from a future date', () => {
    expect(ageDays('2026-08-20', '2026-08-17')).toBe(0)
  })

  it('chases only what is open and old enough', () => {
    const old = '2026-08-14', today = '2026-08-17'
    expect(ageDays(old, today)).toBe(STALE_REQUEST_DAYS)
    expect(isStale(old, today, 'pending')).toBe(true)
    expect(isStale(old, today, 'part_issued')).toBe(true)
    // Finished business is not a queue, however old.
    expect(isStale(old, today, 'issued')).toBe(false)
    expect(isStale(old, today, 'rejected')).toBe(false)
    expect(isStale(today, today, 'pending')).toBe(false)
  })

  it('agrees with isOpen about what is still somebody’s problem', () => {
    expect(isOpen('pending')).toBe(true)
    expect(isOpen('checked')).toBe(true)
    expect(isOpen('approved')).toBe(true)
    expect(isOpen('part_issued')).toBe(true)
    expect(isOpen('issued')).toBe(false)
    expect(isOpen('rejected')).toBe(false)
    expect(isOpen('cancelled')).toBe(false)
  })

  it('names every status in words, not in enum', () => {
    for (const s of Object.keys(STATUS_LABEL) as RequestStatus[]) {
      expect(STATUS_LABEL[s]).not.toMatch(/_/)
    }
  })
})

describe('stock across every store, now that the engineer picks none', () => {
  it('adds an item up over the stores holding it', () => {
    const m = foldStock([
      { itemId: 'cement', qty: 200 }, { itemId: 'cement', qty: 140 },
      { itemId: 'sand', qty: 12 },
    ])
    expect(m.get('cement')).toEqual({ itemId: 'cement', qty: 340, stores: 2 })
    expect(m.get('sand')).toEqual({ itemId: 'sand', qty: 12, stores: 1 })
  })

  it('ignores a zero or negative row rather than counting the store', () => {
    const m = foldStock([{ itemId: 'a', qty: 5 }, { itemId: 'a', qty: 0 }])
    expect(m.get('a')).toEqual({ itemId: 'a', qty: 5, stores: 1 })
  })



})

describe('the signed gate pass', () => {
  const h = (over: Partial<Handover> = {}): Handover => ({
    entryNo: 'Out: 22Aug26/007', voided: false, passPages: 0, ...over,
  })

  it('owes a pass on a handover that has none', () => {
    expect(passPending(h())).toBe(true)
  })

  it('is satisfied by one page', () => {
    expect(passPending(h({ passPages: 1 }))).toBe(false)
  })

  it('never chases a voided handover — it did not happen', () => {
    expect(passPending(h({ voided: true }))).toBe(false)
  })

  it('does not close a fully issued request while a pass is missing', () => {
    // The paperwork is part of the handover, not an optional extra.
    expect(requestClosed('issued', [h()])).toBe(false)
    expect(requestClosed('issued', [h({ passPages: 2 })])).toBe(true)
  })

  it('does not close a part-issued request even with every pass in', () => {
    expect(requestClosed('part_issued', [h({ passPages: 1 })])).toBe(false)
  })

  it('closes a fully issued request whose only missing pass was voided', () => {
    expect(requestClosed('issued', [h({ passPages: 1 }), h({ voided: true })])).toBe(true)
  })

  it('names the one entry that is short, or counts them when several are', () => {
    expect(passLabel([h({ entryNo: 'Out: 22Aug26/007' })]))
      .toBe('Out: 22Aug26/007 has no signed gate pass attached')
    expect(passLabel([h(), h({ entryNo: 'Out: 22Aug26/008' })]))
      .toBe('2 handovers have no signed gate pass attached')
  })

  it('says nothing when every pass is in', () => {
    expect(passLabel([h({ passPages: 1 })])).toBeNull()
    expect(passLabel([])).toBeNull()
  })
})
