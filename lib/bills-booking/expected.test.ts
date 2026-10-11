import { describe, it, expect } from 'vitest'
import { expectedLadder } from './load-calc'
import type { CertMoney } from './calc'

/** Aksha, 11 Oct 2026 — "How this bill adds up" on Desai RA-3
 *  (WO/SRASSK/WCE/2026-27/90, SRASSK-MS-WC-03) read basic ₹1,84,413 and net
 *  ₹2,08,386: GST was backed OUT of ₹2,17,608, which is the measured basic.
 *  His abstract sheet: basic ₹2,17,608 + GST ₹39,169 = ₹2,56,777, retention
 *  ₹10,880, net ₹2,45,897. Rates from RA-1 and RA-2 as certified in IN4. */
const cert = (o: Partial<CertMoney>): CertMoney => ({
  certificateId: 1, displayNo: null, invoiceNo: null, createdOn: null, statusName: 'Partially Paid',
  certified: 0, gross: 0, retention: 0, advanceRecovery: 0, recoveries: 0, deductions: 0,
  paid: 0, outstanding: 0, ...o,
})
const CERTS = [
  cert({ certificateId: 184, invoiceNo: 'SRASSK-MS-WC-01', certified: 1223272.27, gross: 1443461.27, retention: 61164 }),
  cert({ certificateId: 232, invoiceNo: 'SRASSK-MS-WC-02', certified: 563930.99, gross: 665438.57, retention: 28197 }),
]
const amount = (l: ReturnType<typeof expectedLadder>, label: string) => l!.steps.find(s => s.label === label)?.amount

describe('expected figures before IN4 certifies', () => {
  it('starts from the measured basic and adds tax on top — as the abstract sheet does', () => {
    const l = expectedLadder(CERTS, 217607.898, 217607.898)
    expect(amount(l, 'Basic value certified')).toBe(217608)
    expect(amount(l, 'GST')).toBe(39169)
    expect(amount(l, 'Gross bill')).toBe(256777)
    expect(amount(l, 'Retention held')).toBe(10880)
    expect(l!.netPayable).toBe(245897)
  })

  it('reads the claim as gross only when nothing is measured yet', () => {
    const l = expectedLadder(CERTS, null, 256777)
    expect(amount(l, 'Basic value certified')).toBe(217608)
    expect(l!.netPayable).toBe(245897)
  })

  it('says nothing when the order has no certificate to take rates from', () => {
    expect(expectedLadder([], 217608, 217608)).toBeNull()
  })
})
