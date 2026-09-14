import { describe, it, expect } from 'vitest'
import { buildDaily, trustOf, type DailyCert, type DailyEvent } from './daily'

const NOW = new Date('2026-09-14T09:00:00Z').getTime()
const names = new Map([[5, 'Staff Facilities Block'], [12, 'New Guest House']])

const cert = (o: Partial<DailyCert>): DailyCert => ({
  certificate_id: 1, display_no: 'ENP/SRASSK/SQ/2026-27/237', wo_no: 'WO/SRASSK/SQ/2026-27/105',
  contractor_name: 'Amin Developers', project_id: 5, subproject_id: 5, status_name: 'Approved',
  outstanding_amt: 1_261_817, creation_dt: '2026-09-12', ...o,
})
const ev = (o: Partial<DailyEvent>): DailyEvent => ({
  certificate_id: 1, at: '2026-09-13T10:00:00Z', status_name: 'Paid', actor_name: 'Jay Bharucha', ...o,
})

describe('trust from the work-order number', () => {
  it('reads the trust out of the number itself', () => {
    expect(trustOf('WO/SRASSK/SQ/2026-27/105')).toBe('SRASSK')
    expect(trustOf('WO/SRET/RU/2026-27/167')).toBe('SRET')
    expect(trustOf('WOSP/SRJT/SRAH/2023-24/2')).toBe('SRJT')   // the older prefix still works
  })
  it('returns null rather than guessing when the shape is wrong', () => {
    expect(trustOf(null)).toBeNull()
    expect(trustOf('')).toBeNull()
    expect(trustOf('SOMETHING')).toBeNull()
    expect(trustOf('WO/12345/SQ/1')).toBeNull()
  })
})

describe('daily report', () => {
  it('lists what was paid inside the window, newest first', () => {
    const certs = [
      cert({ certificate_id: 1, outstanding_amt: 243_513, status_name: 'Paid' }),
      cert({ certificate_id: 2, outstanding_amt: 90_000, status_name: 'Paid' }),
      cert({ certificate_id: 3, outstanding_amt: 500, status_name: 'Paid' }),
    ]
    const { paid, paidTotal } = buildDaily(certs, [
      ev({ certificate_id: 1, at: '2026-09-13T10:00:00Z' }),
      ev({ certificate_id: 2, at: '2026-09-12T10:00:00Z' }),
      ev({ certificate_id: 3, at: '2026-08-01T10:00:00Z' }),   // outside the window
    ], names, { paidWithinDays: 3, now: NOW })

    expect(paid.map(r => r.certificateId)).toEqual([1, 2])
    expect(paid[0].on).toBe('2026-09-13')
    expect(paid[0].by).toBe('Jay Bharucha')
    expect(paidTotal).toBe(333_513)
  })

  it('groups what is at the trust by the trust in the WO number, biggest block first', () => {
    const certs = [
      cert({ certificate_id: 1, wo_no: 'WO/SRASSK/NGH/2026-27/1', outstanding_amt: 7_015_501, project_id: 12 }),
      cert({ certificate_id: 2, wo_no: 'WO/SRET/RU/2026-27/2', outstanding_amt: 423_637 }),
      cert({ certificate_id: 3, wo_no: 'WO/SRET/RU/2026-27/3', outstanding_amt: 30_440 }),
    ]
    const { atTrust, atTrustTotal } = buildDaily(certs, [], names, { now: NOW })
    expect(atTrust.map(t => t.trust)).toEqual(['SRASSK', 'SRET'])
    expect(atTrust[1].rows).toHaveLength(2)
    expect(atTrustTotal).toBe(7_469_578)
  })

  it('shows certificates with no readable trust instead of dropping them', () => {
    const { atTrust, unassigned } = buildDaily(
      [cert({ certificate_id: 9, wo_no: null, outstanding_amt: 1000 })], [], names, { now: NOW })
    expect(atTrust).toEqual([])
    expect(unassigned.map(r => r.certificateId)).toEqual([9])
  })

  it('ages an at-trust row from its approval, and sorts the oldest to the top', () => {
    const certs = [
      cert({ certificate_id: 1, outstanding_amt: 100 }),
      cert({ certificate_id: 2, outstanding_amt: 900 }),
    ]
    const { atTrust } = buildDaily(certs, [
      ev({ certificate_id: 1, at: '2026-08-25T00:00:00Z', status_name: 'Approved', actor_name: 'Akshay Parekh' }),
      ev({ certificate_id: 2, at: '2026-09-12T00:00:00Z', status_name: 'Approved', actor_name: 'Amit Gala' }),
    ], names, { now: NOW })

    expect(atTrust[0].rows.map(r => r.certificateId)).toEqual([1, 2])   // 20 days before 2
    expect(atTrust[0].rows[0].days).toBe(20)
    expect(atTrust[0].rows[0].by).toBe('Akshay Parekh')
  })

  it('leaves nothing at the trust when the money is already settled', () => {
    const { atTrust } = buildDaily([cert({ outstanding_amt: 0 })], [], names, { now: NOW })
    expect(atTrust).toEqual([])
  })

  it('counts a payment even when the certificate later went back to part-paid', () => {
    // Paid on the 13th, then Partially Paid after — money still left that day.
    const { paid } = buildDaily(
      [cert({ certificate_id: 1, status_name: 'Partially Paid', outstanding_amt: 5_000 })],
      [ev({ certificate_id: 1, at: '2026-09-13T10:00:00Z', status_name: 'Paid' })],
      names, { now: NOW })
    expect(paid).toHaveLength(1)
  })
})
