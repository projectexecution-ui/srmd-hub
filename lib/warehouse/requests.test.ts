import { describe, expect, it } from 'vitest'
import {
  estimateValue, stagesNeeded, approvalPreview, raiseBlocker, shortfalls,
  approveBlocker, statusAfterApproval, rejectBlocker, issuableBlocker,
  outstanding, statusAfterIssue, fulfilledPct, isOpen, ageDays, isStale,
  STALE_REQUEST_DAYS, STATUS_LABEL,
} from './requests'
import type { ApprovalConfig, RaiseInput, RequestState, RequestStatus } from './requests'

const money = (n: number) => `Rs ${n.toLocaleString('en-IN')}`
const cfg = (o: Partial<ApprovalConfig> = {}): ApprovalConfig =>
  ({ rule: 'off', threshold: 0, stages: 1, ...o })

// ===========================================================================
// The approval dial
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

describe('how many approvals a request needs', () => {
  const est = { value: 50_000, partial: false }

  it('needs none when the rule is off', () => {
    expect(stagesNeeded(cfg({ rule: 'off' }), est, true)).toBe(0)
  })

  it('needs every stage when the rule is always', () => {
    expect(stagesNeeded(cfg({ rule: 'always', stages: 2 }), est, true)).toBe(2)
  })

  it('compares against the threshold when the rule is by value', () => {
    const c = cfg({ rule: 'above_value', threshold: 25_000 })
    expect(stagesNeeded(c, { value: 50_000, partial: false }, true)).toBe(1)
    expect(stagesNeeded(c, { value: 10_000, partial: false }, true)).toBe(0)
  })

  it('treats exactly the threshold as under it, not over', () => {
    const c = cfg({ rule: 'above_value', threshold: 25_000 })
    expect(stagesNeeded(c, { value: 25_000, partial: false }, true)).toBe(0)
  })

  it('DEMANDS approval when nothing can be priced — the hole somebody would find', () => {
    // Otherwise a request of entirely unpriced items sails past a value rule.
    const c = cfg({ rule: 'above_value', threshold: 25_000 })
    expect(stagesNeeded(c, { value: 0, partial: true }, false)).toBe(1)
  })
})

describe('telling the requester before he submits', () => {
  it('says it goes straight through when nothing is needed', () => {
    expect(approvalPreview(cfg(), { value: 0, partial: false }, true, money))
      .toContain('straight to the storekeeper')
  })

  it('names both approvers on a two-stage chain', () => {
    const p = approvalPreview(cfg({ rule: 'always', stages: 2 }), { value: 0, partial: false }, true, money)
    expect(p).toContain('Atm Head')
    expect(p).toContain('Trustee')
  })

  it('shows the value and the limit when value is what triggered it', () => {
    const p = approvalPreview(
      cfg({ rule: 'above_value', threshold: 25_000 }),
      { value: 60_000, partial: false }, true, money)
    expect(p).toContain('60,000')
    expect(p).toContain('25,000')
  })

  it('explains itself when the trigger was a missing rate, not a big number', () => {
    const p = approvalPreview(
      cfg({ rule: 'above_value', threshold: 25_000 }),
      { value: 0, partial: true }, false, money)
    expect(p).toContain('no item here has a known rate')
  })

  it('says why a cheap request is NOT waiting, so silence is never mysterious', () => {
    const p = approvalPreview(
      cfg({ rule: 'above_value', threshold: 25_000 }),
      { value: 500, partial: false }, true, money)
    expect(p).toContain('under the')
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

  it('needs a store', () => {
    expect(raiseBlocker(good({ fromLocationId: '' }), '2026-08-17')).toContain('store you are asking')
  })

  it('refuses a transfer to the same store it is asking', () => {
    expect(raiseBlocker(good({ toLocationId: 'A' }), '2026-08-17')).toContain('nothing would move')
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

// ===========================================================================
// Approving
// ===========================================================================
describe('approving', () => {
  const st = (o: Partial<RequestState> = {}): RequestState => ({
    reqNo: 'Rq: 17Aug26/001', status: 'pending',
    stagesNeeded: 1, stagesDone: 0, requestedBy: 'eng', approvers: [],
    ...o,
  })

  it('lets an Atm Head approve a waiting request', () => {
    expect(approveBlocker(st(), 'head1', true)).toBeNull()
  })

  it('refuses the requester approving his own request', () => {
    expect(approveBlocker(st({ requestedBy: 'head1' }), 'head1', true))
      .toContain('cannot approve it')
  })

  it('refuses one person filling both stages of a two-stage chain', () => {
    const r = st({ stagesNeeded: 2, stagesDone: 1, approvers: ['head1'] })
    expect(approveBlocker(r, 'head1', true)).toContain('somebody else')
  })

  it('lets a DIFFERENT person fill the second stage', () => {
    const r = st({ stagesNeeded: 2, stagesDone: 1, approvers: ['head1'] })
    expect(approveBlocker(r, 'trustee', true)).toBeNull()
  })

  it('refuses someone without the authority', () => {
    expect(approveBlocker(st(), 'keeper', false)).toContain('admin or Atm Head')
  })

  it('refuses a request that is not waiting', () => {
    for (const s of ['approved', 'issued', 'part_issued'] as RequestStatus[]) {
      expect(approveBlocker(st({ status: s }), 'head1', true)).toContain('not waiting')
    }
    expect(approveBlocker(st({ status: 'cancelled' }), 'head1', true)).toContain('cancelled')
    expect(approveBlocker(st({ status: 'rejected' }), 'head1', true)).toContain('rejected')
  })

  it('moves to approved on the last stage, stays pending before it', () => {
    expect(statusAfterApproval(st({ stagesNeeded: 1, stagesDone: 0 }))).toBe('approved')
    expect(statusAfterApproval(st({ stagesNeeded: 2, stagesDone: 0 }))).toBe('pending')
    expect(statusAfterApproval(st({ stagesNeeded: 2, stagesDone: 1 }))).toBe('approved')
  })
})

describe('rejecting', () => {
  const r: RequestState = {
    reqNo: 'Rq: 17Aug26/001', status: 'pending',
    stagesNeeded: 1, stagesDone: 0, requestedBy: 'eng', approvers: [],
  }

  it('needs a reason worth reading', () => {
    expect(rejectBlocker(r, 'no', true)).toContain('Give a reason')
    expect(rejectBlocker(r, 'Not budgeted this month', true)).toBeNull()
  })

  it('needs the authority', () => {
    expect(rejectBlocker(r, 'Not budgeted this month', false)).toContain('admin or Atm Head')
  })
})

// ===========================================================================
// Issuing against it
// ===========================================================================
describe('issuing against a request', () => {
  const st = (o: Partial<RequestState> = {}): RequestState => ({
    reqNo: 'Rq: 17Aug26/001', status: 'approved',
    stagesNeeded: 1, stagesDone: 1, requestedBy: 'eng', approvers: ['head1'],
    ...o,
  })

  it('allows it once approved', () => {
    expect(issuableBlocker(st())).toBeNull()
  })

  it('blocks it while approval is outstanding, and says how many are left', () => {
    const b = issuableBlocker(st({ status: 'pending', stagesNeeded: 2, stagesDone: 0 }))
    expect(b).toContain('2 approvals')
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
