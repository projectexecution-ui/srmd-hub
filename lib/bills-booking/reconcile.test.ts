import { describe, it, expect } from 'vitest'
import { checkOne, checkAll, noticeFor, TOLERANCE, type Sanction, type In4Cert, type In4Approval } from './reconcile'

const s = (o: Partial<Sanction> = {}): Sanction => ({
  id: 'sanction-1', certificateId: 3107, displayNo: 'ENP/SRASSK/SQ/2026-27/237',
  sanctionedAmount: 1_261_817, sanctionedAt: '2026-09-12T10:00:00Z',
  verdict: null, notifiedAt: null, ...o,
})
const cert = (o: Partial<In4Cert> = {}): In4Cert => ({
  certificateId: 3107, statusName: 'Approved', payable: 1_261_817, ...o,
})
const approval: In4Approval = { at: '2026-09-13T06:00:00Z', actorName: 'Jay Bharucha' }

describe('reconciliation', () => {
  it('matches when IN4 lands on the sanctioned figure', () => {
    const c = checkOne(s(), cert(), approval)
    expect(c.verdict).toBe('matched')
    expect(c.difference).toBeNull()
    expect(c.in4ApprovedBy).toBe('Jay Bharucha')
    expect(c.shouldNotify).toBe(true)          // first time
  })

  it('says nothing again once a match has been reported', () => {
    expect(checkOne(s({ verdict: 'matched' }), cert(), approval).shouldNotify).toBe(false)
  })

  it('flags a difference and keeps the sign', () => {
    const higher = checkOne(s({ sanctionedAmount: 7_015_501 }), cert({ payable: 7_015_105 }), approval)
    expect(higher.verdict).toBe('amount_differs')
    expect(higher.difference).toBe(-396)       // IN4 is lower
    expect(noticeFor(higher)!.title).toContain('₹396 lower in IN4')

    const lower = checkOne(s({ sanctionedAmount: 1000 }), cert({ payable: 1400 }), approval)
    expect(lower.difference).toBe(400)
    expect(noticeFor(lower)!.title).toContain('higher')
  })

  it('repeats a difference until it has actually been sent', () => {
    // verdict already recorded, but the notice never went out
    expect(checkOne(s({ verdict: 'amount_differs', notifiedAt: null }), cert({ payable: 9 }), approval).shouldNotify).toBe(true)
    // and once it has, it stays quiet
    expect(checkOne(s({ verdict: 'amount_differs', notifiedAt: '2026-09-13T07:00:00Z' }), cert({ payable: 9 }), approval).shouldNotify).toBe(false)
  })

  it('ignores rounding below a rupee but never a rupee more', () => {
    expect(checkOne(s(), cert({ payable: 1_261_817 + TOLERANCE }), approval).verdict).toBe('matched')
    expect(checkOne(s(), cert({ payable: 1_261_817 + TOLERANCE + 0.5 }), approval).verdict).toBe('amount_differs')
  })

  it('waits quietly while the bill is still climbing the desks', () => {
    for (const st of ['Submitted', 'Verify', 'ReSubmit', 'Hold']) {
      const c = checkOne(s(), cert({ statusName: st }), null)
      expect(c.verdict).toBe('awaiting_in4')
      expect(c.shouldNotify).toBe(false)
      expect(noticeFor(c)).toBeNull()
    }
  })

  it('still compares once the bill is past approval, even with no trail row', () => {
    // Processed/Paid with the approval event missing from the mirror — the
    // money has moved, so silence would be wrong.
    const c = checkOne(s({ sanctionedAmount: 100 }), cert({ statusName: 'Paid', payable: 900 }), null)
    expect(c.verdict).toBe('amount_differs')
    expect(c.shouldNotify).toBe(true)
  })

  it('shouts when the certificate has left IN4 entirely', () => {
    const c = checkOne(s(), null, null)
    expect(c.verdict).toBe('gone')
    expect(c.shouldNotify).toBe(true)
    expect(noticeFor(c)!.body).toContain('no longer in IN4')
    // and does not shout twice
    expect(checkOne(s({ verdict: 'gone' }), null, null).shouldNotify).toBe(false)
  })

  it('checks a whole batch, matching each sanction to its own certificate', () => {
    const out = checkAll(
      [s({ id: 'a', certificateId: 1, sanctionedAmount: 100 }), s({ id: 'b', certificateId: 2, sanctionedAmount: 200 })],
      new Map([[1, cert({ certificateId: 1, payable: 100 })], [2, cert({ certificateId: 2, payable: 250 })]]),
      new Map([[1, approval], [2, approval]]),
    )
    expect(out.map(c => c.verdict)).toEqual(['matched', 'amount_differs'])
    expect(out[1].difference).toBe(50)
  })
})
