import { describe, it, expect } from 'vitest'
import { billLadder, woHistory, type CertMoney } from './calc'

/** The figures below are REAL, read out of the mirror on 14 Sep 2026 — work
 *  order 1537, WO/SRASSK/NGH/2025-26/271, Kasturi Projects, NGH B. Pinning the
 *  arithmetic to bills that exist is the only way to know the ladder is the
 *  one IN4 actually uses rather than the one I assumed. */
const cert = (o: Partial<CertMoney> = {}): CertMoney => ({
  certificateId: 2417, displayNo: 'ENP/SRASSK/NGH/2025-26/500', invoiceNo: 'KP362SRA51',
  createdOn: '2026-03-25', statusName: 'Paid',
  certified: 160482, gross: 189369, retention: 48144, advanceRecovery: 0,
  recoveries: 0, deductions: 2, paid: 138014, outstanding: 3209, ...o,
})

// The five real certificates on work order 1537, in order.
const WO_1537: CertMoney[] = [
  cert(),
  cert({ certificateId: 2717, displayNo: 'ENP/SRASSK/NGH/2026-27/91', invoiceNo: 'KP362SRA06',
         createdOn: '2026-06-02', certified: 284564, gross: 335785, retention: 28456,
         deductions: 0, paid: 301639, outstanding: 5690 }),
  cert({ certificateId: 2719, displayNo: 'ENP/SRASSK/NGH/2026-27/93', invoiceNo: 'KP362SRA51 ( Hold Amount Release )',
         createdOn: '2026-06-02', certified: 32096, gross: 32096, retention: 0,
         deductions: 0, paid: 0, outstanding: 0 }),
  cert({ certificateId: 2844, displayNo: 'ENP/SRASSK/NGH/2026-27/134', invoiceNo: 'KP362SRA12',
         createdOn: '2026-06-30', certified: 461685, gross: 544788, retention: 46169,
         deductions: 0, paid: 489385, outstanding: 9234 }),
  cert({ certificateId: 3038, displayNo: 'ENP/SRASSK/NGH/2026-27/213', invoiceNo: 'KP362SERT20',
         createdOn: '2026-08-22', certified: 616302, gross: 727237, retention: 61630,
         deductions: 0, paid: 653282, outstanding: 12325 }),
]

const amountOf = (l: ReturnType<typeof billLadder>, label: string) =>
  l.steps.find(s => s.label === label)?.amount

describe('how a bill adds up', () => {
  it('reconciles to the rupee on a real certificate', () => {
    const l = billLadder(cert())
    // 160,482 × 1.18 = 189,369 gross; − 48,144 retention − 2 − 138,014 paid = 3,209
    expect(amountOf(l, 'Basic value certified')).toBe(160482)
    expect(amountOf(l, 'GST')).toBe(28887)
    expect(amountOf(l, 'Gross bill')).toBe(189369)
    expect(l.netPayable).toBe(141223)
    expect(l.stillOwed).toBe(3209)
    expect(l.reconciles).toBe(true)
    expect(l.outBy).toBe(0)
  })

  it('reconciles on four of the five, and flags the fifth instead of fudging it', () => {
    // Certificate 2719 is "KP362SRA51 ( Hold Amount Release )" — it releases an
    // amount held back on an earlier bill. The ladder makes it ₹32,096 owed;
    // IN4 settles it to ₹0, because a release is an adjustment and not a
    // payment. That is a real shape this model does not cover, and the honest
    // answer is to SAY the two disagree — not to bend the arithmetic until it
    // agrees, on a screen somebody approves money from.
    const bad = WO_1537.filter(c => !billLadder(c).reconciles)
    expect(bad.map(c => c.certificateId)).toEqual([2719])
    for (const c of WO_1537.filter(c => c.certificateId !== 2719)) {
      const l = billLadder(c)
      expect(l.reconciles, `${c.displayNo} out by ${l.outBy}`).toBe(true)
    }
    const l = billLadder(WO_1537[2])
    expect(l.stillOwed).toBe(32096)
    expect(l.in4Outstanding).toBe(0)   // both figures survive, so the screen can show both
  })

  it('reads the GST rate off the bill rather than assuming 18%', () => {
    expect(billLadder(cert()).gstPct).toBe(18)
    // 1,871 of 3,107 certificates have no tax at all — labour and
    // reimbursement bills. Assuming 18% would invent nearly ₹30k here.
    const none = billLadder(cert({ certified: 32096, gross: 32096, retention: 0, deductions: 0, paid: 0, outstanding: 32096 }))
    expect(none.gstPct).toBeNull()
    expect(amountOf(none, 'GST')).toBe(0)
    expect(none.steps.find(s => s.label === 'GST')?.note).toMatch(/none on this bill/)
  })

  it('refuses to call an odd figure a rate', () => {
    // 12.5% is a rate; 11.37% is a number somebody worked out for one bill, and
    // printing it as a rate invents a rule that does not exist.
    expect(billLadder(cert({ certified: 100000, gross: 112500 })).gstPct).toBe(12.5)
    expect(billLadder(cert({ certified: 100000, gross: 111373 })).gstPct).toBeNull()
  })

  it('shows retention as the rate IN4 actually deducted, per work order', () => {
    // 10% on the later bills of this order, not the 5% house rule.
    expect(billLadder(WO_1537[1]).retentionPct).toBe(10)
    expect(billLadder(WO_1537[3]).retentionPct).toBe(10)
    // The first bill held 30% — an extra hold, released later by cert 2719.
    expect(billLadder(WO_1537[0]).retentionPct).toBe(30)
  })

  it('leaves out the lines that are zero, so the ladder stays readable', () => {
    const l = billLadder(cert({ retention: 0, deductions: 0, advanceRecovery: 0, recoveries: 0, paid: 0, outstanding: 189369 }))
    for (const gone of ['Retention held', 'Advance recovered', 'Other recoveries', 'Deductions', 'Already paid']) {
      expect(l.steps.map(s => s.label)).not.toContain(gone)
    }
    expect(l.netPayable).toBe(189369)
  })

  it('says so when the parts do not add up', () => {
    // An approval record must never quietly show a total that is wrong.
    const l = billLadder(cert({ outstanding: 99999 }))
    expect(l.reconciles).toBe(false)
    expect(Math.round(l.outBy)).toBe(3209 - 99999)
  })

  it('names the advance recovery, which is why payable can be far below the bill', () => {
    const l = billLadder(cert({ certified: 1000000, gross: 1180000, retention: 50000,
      advanceRecovery: 1130000, deductions: 0, paid: 0, outstanding: 0 }))
    expect(l.netPayable).toBe(0)
    expect(l.steps.find(s => s.label === 'Advance recovered')?.note).toMatch(/advance being taken back/)
  })
})

describe('the bills already on this work order', () => {
  // Newest first, because that is the bill being looked at. On an order with
  // thirteen of them the current position used to be at the bottom of a scroll.
  it('hands them back newest first, with RA numbers still counted from the oldest', () => {
    const h = woHistory(WO_1537, 6069440)
    expect(h.rows.map(r => r.ra)).toEqual([5, 4, 3, 2, 1])
    expect(h.rows[0].displayNo).toBe('ENP/SRASSK/NGH/2026-27/213')   // 22 Aug, the latest
    expect(h.rows.at(-1)!.displayNo).toBe('ENP/SRASSK/NGH/2025-26/500') // 25 Mar, the first
  })

  it('still builds the cumulative in date order, so the top row is today', () => {
    const h = woHistory(WO_1537, 6069440)
    // The oldest bill's cumulative is just itself…
    expect(h.rows.at(-1)!.cumulativeGross).toBe(189369)
    expect(h.billedGross).toBe(189369 + 335785 + 32096 + 544788 + 727237)
    expect(h.leftToBill).toBe(6069440 - h.billedGross)
    // …and the newest row now carries the order's position today, at the top.
    expect(h.rows[0].cumulativeGross).toBe(h.billedGross)
    expect(h.rows[0].leftToBill).toBe(h.leftToBill)
  })

  it('adds up the retention actually held across the order', () => {
    const h = woHistory(WO_1537, 6069440)
    expect(h.retentionHeld).toBe(48144 + 28456 + 46169 + 61630)
    expect(h.paid).toBe(138014 + 301639 + 489385 + 653282)
  })

  // 83 cancelled certificates carry ₹4.3 Cr of "outstanding" that is not owed.
  // Dropping them silently is how somebody reconciling by hand finds a hole.
  it('shows a cancelled bill greyed rather than dropping it, and counts it nowhere', () => {
    const h = woHistory([...WO_1537, cert({ certificateId: 9999, statusName: 'Cancelled',
      createdOn: '2026-09-01', certified: 500000, gross: 590000, retention: 50000, paid: 0, outstanding: 540000 })], 6069440)
    expect(h.rows).toHaveLength(6)
    const dead = h.rows.find(r => r.certificateId === 9999)!
    expect(dead.dead).toBe(true)
    expect(dead.ra).toBe(0)
    expect(h.deadCount).toBe(1)
    // …and it moves none of the money.
    expect(h.billedGross).toBe(woHistory(WO_1537, 6069440).billedGross)
    expect(h.retentionHeld).toBe(woHistory(WO_1537, 6069440).retentionHeld)
  })

  it('never shows a negative balance when an order has been over-billed', () => {
    const h = woHistory(WO_1537, 100000)
    expect(h.leftToBill).toBe(0)
    expect(h.rows.every(r => r.leftToBill >= 0)).toBe(true)
  })

  it('copes with an order that has no bills yet', () => {
    const h = woHistory([], 2821500)
    expect(h.rows).toEqual([])
    expect(h.billedGross).toBe(0)
    expect(h.leftToBill).toBe(2821500)
  })
})

/** The four certificates the live examples point at, straight from the mirror.
 *  If the ladder is wrong on these, it is wrong on the screens Aksha reviews. */
describe('the certificates behind the live examples', () => {
  it('EX-04 — advance recovery is why payable is far below the bill', () => {
    const l = billLadder(cert({ certificateId: 1537, displayNo: 'ENP/SRJT/SRAH/2025-26/128',
      certified: 570161, gross: 672790, retention: 67278, advanceRecovery: 272000,
      deductions: 3397, paid: 330115, outstanding: 0 }))
    expect(l.gstPct).toBe(18)
    expect(l.retentionPct).toBeCloseTo(11.8, 1)
    // 6,72,790 − 67,278 − 2,72,000 − 3,397 = 3,30,115, all of it paid.
    expect(l.netPayable).toBe(330115)
    expect(l.stillOwed).toBe(0)
    expect(l.reconciles).toBe(true)
    expect(l.steps.map(s => s.label)).toContain('Advance recovered')
  })

  // This is one of the 613 certificates (20%) where IN4's own outstanding does
  // not follow from the parts it publishes. The ladder does NOT bend to match:
  // it shows its own working, shows what IN4 says, and flags the gap. On a
  // screen somebody releases crores from, a total that silently agrees is far
  // worse than one that admits it cannot explain itself.
  it('EX-06 — crores, and the one case where IN4 does not add up', () => {
    const l = billLadder(cert({ certificateId: 2460, certified: 10249856, gross: 12094830,
      retention: 479866, advanceRecovery: 0, deductions: 0, paid: 10712474, outstanding: 132497 }))
    expect(l.gstPct).toBe(18)
    expect(l.netPayable).toBe(11614964)
    expect(l.stillOwed).toBe(902490)      // 1,16,14,964 less the 1,07,12,474 paid
    expect(l.in4Outstanding).toBe(132497) // …but IN4 publishes this
    expect(l.reconciles).toBe(false)
    expect(Math.round(l.outBy)).toBe(769993)
  })

  it('EX-09 — 5% retention, part paid', () => {
    const l = billLadder(cert({ certificateId: 1581, certified: 241258, gross: 284684,
      retention: 12063, advanceRecovery: 0, deductions: 0, paid: 133604, outstanding: 139017 }))
    expect(l.gstPct).toBe(18)
    expect(l.retentionPct).toBe(5)
    expect(l.stillOwed).toBe(139017)
    expect(l.reconciles).toBe(true)
  })

  it('EX-10 — no GST at all, which is the majority case', () => {
    const l = billLadder(cert({ certificateId: 330, certified: 1791475, gross: 1791475,
      retention: 0, advanceRecovery: 0, deductions: 0, paid: 1753306, outstanding: 38169 }))
    expect(l.gstPct).toBeNull()
    expect(amountOf(l, 'GST')).toBe(0)
    expect(amountOf(l, 'Gross bill')).toBe(1791475)
    expect(l.stillOwed).toBe(38169)
    expect(l.reconciles).toBe(true)
  })
})
