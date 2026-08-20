import { describe, expect, it } from 'vitest'
import {
  totalReceived, linePending, lineDone, derivedStatus, nextStatus, offerAtGate,
} from './po-balance'
import type { PoLineNumbers } from './po-balance'

const line = (ordered: number, receivedBefore = 0, receivedAtGate = 0): PoLineNumbers =>
  ({ ordered, receivedBefore, receivedAtGate })

describe('the bug this module exists to close', () => {
  it('does not present a PO already delivered in IN4 as still to come', () => {
    // The real shape of the problem: 500 ordered, 500 received in IN4 long
    // before this system existed, nothing through our gate. The old arithmetic
    // was ordered − gateReceipts = 500 still to come.
    const l = line(500, 500, 0)
    expect(linePending(l)).toBe(0)
    expect(lineDone(l)).toBe(true)
    expect(derivedStatus([l])).toBe('fully_received')
  })

  it('keeps only the genuine balance on a part-delivered order', () => {
    const l = line(800, 600, 0)
    expect(linePending(l)).toBe(200)
    expect(derivedStatus([l])).toBe('partly_received')
  })

  it('nets our own gate receipts on top of IN4 history', () => {
    const l = line(800, 600, 150)
    expect(totalReceived(l)).toBe(750)
    expect(linePending(l)).toBe(50)
  })

  it('closes the line when the gate finishes what IN4 started', () => {
    const l = line(800, 600, 200)
    expect(linePending(l)).toBe(0)
    expect(derivedStatus([l])).toBe('fully_received')
  })
})

describe('a genuinely open order still works', () => {
  it('reports the full quantity when nothing has been received anywhere', () => {
    const l = line(1000)
    expect(linePending(l)).toBe(1000)
    expect(derivedStatus([l])).toBe('open')
    expect(offerAtGate('open', [l])).toBe(true)
  })
})

describe('over-delivery', () => {
  it('never reports a negative amount still to come', () => {
    // Over-receipt is real and has its own control report; it is not a negative
    // pending quantity.
    const l = line(100, 100, 25)
    expect(linePending(l)).toBe(0)
    expect(totalReceived(l)).toBe(125)
  })
  it('counts an over-delivered PO as finished, not as owing', () => {
    expect(derivedStatus([line(100, 130, 0)])).toBe('fully_received')
  })
})

describe('status across many lines', () => {
  it('is fully received only when every line is', () => {
    expect(derivedStatus([line(100, 100), line(50, 50)])).toBe('fully_received')
    expect(derivedStatus([line(100, 100), line(50, 20)])).toBe('partly_received')
  })
  it('is open when the whole order is untouched', () => {
    expect(derivedStatus([line(100), line(50)])).toBe('open')
  })
  it('is partly received when one line has moved and another has not', () => {
    expect(derivedStatus([line(100, 40), line(50, 0)])).toBe('partly_received')
  })
  it('treats a PO with no lines as open rather than complete', () => {
    // A PO whose lines failed to import must not read as "nothing to receive".
    expect(derivedStatus([])).toBe('open')
  })
})

describe('a human decision outranks the arithmetic', () => {
  it('leaves a short-closed PO short-closed even with a balance outstanding', () => {
    expect(nextStatus('short_closed', [line(800, 100)])).toBe('short_closed')
  })
  it('leaves it short-closed even if a late delivery completes it', () => {
    expect(nextStatus('short_closed', [line(800, 800)])).toBe('short_closed')
  })
  it('otherwise takes the derived status', () => {
    expect(nextStatus('open', [line(800, 800)])).toBe('fully_received')
    expect(nextStatus(null, [line(800, 100)])).toBe('partly_received')
    expect(nextStatus('fully_received', [line(800, 100)])).toBe('partly_received')
  })
})

describe('what the gate is allowed to offer', () => {
  it('refuses a completed order, so it cannot be booked twice', () => {
    expect(offerAtGate('fully_received', [line(500, 500)])).toBe(false)
  })
  it('refuses a short-closed order', () => {
    expect(offerAtGate('short_closed', [line(500, 100)])).toBe(false)
  })
  it('offers an order with a real balance', () => {
    expect(offerAtGate('partly_received', [line(800, 600)])).toBe(true)
  })
  it('offers a PO whose lines are not loaded, rather than hiding it silently', () => {
    // The picker fetches heads without lines. Absent lines must not be read as
    // "nothing pending" — that would hide a live order.
    expect(offerAtGate('open', [])).toBe(true)
    expect(offerAtGate('partly_received', [])).toBe(true)
  })
  it('still refuses a completed order when lines are not loaded', () => {
    expect(offerAtGate('fully_received', [])).toBe(false)
  })
})

describe('decimals survive', () => {
  it('handles fractional quantities without drifting', () => {
    expect(linePending(line(10.5, 2.25, 0.25))).toBeCloseTo(8, 10)
  })
})
