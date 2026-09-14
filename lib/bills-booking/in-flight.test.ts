import { describe, it, expect } from 'vitest'
import { buildInFlight, isInFlight, type FlightCert, type FlightEvent } from './in-flight'

const NOW = new Date('2026-09-13T12:00:00Z').getTime()

const cert = (o: Partial<FlightCert>): FlightCert => ({
  certificate_id: 1, kind: 'wo', display_no: 'ENP/SRASSK/SQ/2026-27/237', invoice_no: null, wo_no: 'WO/SRASSK/SQ/2026-27/105',
  contractor_name: 'Amin Developers', project_id: 5, subproject_id: 5, status_name: 'Submitted',
  outstanding_amt: 1_261_817, creation_dt: '2026-09-12', ...o,
})
// Most checks below care only about the rows.
const rowsOf = (c: FlightCert[], e: FlightEvent[], now: number) => buildInFlight(c, e, now).rows
const ev = (o: Partial<FlightEvent>): FlightEvent => ({
  certificate_id: 1, at: '2026-09-12T16:08:48.960Z', status_name: 'Submitted',
  actor_name: 'Jay Bharucha', remark: '', ...o,
})

describe('in-flight queue', () => {
  it('keeps only the live states and names the desk holding each', () => {
    expect(isInFlight('Approved')).toBe(true)
    expect(isInFlight('Hold')).toBe(true)
    expect(isInFlight('Paid')).toBe(false)
    expect(isInFlight('Cancelled')).toBe(false)
    expect(isInFlight(null)).toBe(false)

    const { rows } = buildInFlight([
      cert({ certificate_id: 1, status_name: 'Verify' }),
      cert({ certificate_id: 2, status_name: 'Paid' }),
      cert({ certificate_id: 3, status_name: 'Cancelled' }),
    ], [], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].desk).toBe('Atm Head')
  })

  it('measures the wait from the last movement, not from when the bill was raised', () => {
    const { rows } = buildInFlight(
      [cert({ certificate_id: 1, creation_dt: '2026-06-01', status_name: 'Approved' })],
      [
        ev({ certificate_id: 1, at: '2026-06-01T10:00:00Z', status_name: 'Submitted', actor_name: 'Jay Bharucha' }),
        ev({ certificate_id: 1, at: '2026-09-04T13:32:00Z', status_name: 'Approved', actor_name: 'Akshay Parekh', remark: 'K' }),
      ], NOW)
    expect(rows[0].age).toBe(104)      // since it was raised
    // 4 Sep 13:32 → 13 Sep 12:00 is 8 days and 22 hours. Whole days only: a
    // desk wait is read as "how many nights has this sat there", and rounding
    // 22 hours up to a day would make every fresh bill look a day stale.
    expect(rows[0].atDesk).toBe(8)
    expect(rows[0].movedBy).toBe('Akshay Parekh')
    expect(rows[0].remark).toBe('K')
  })

  it('leaves the desk wait unknown rather than zero when the trail has not synced', () => {
    const { rows, haveTrail } = buildInFlight([cert({})], [], NOW)
    expect(rows[0].atDesk).toBeNull()
    expect(rows[0].movedBy).toBeNull()
    expect(haveTrail).toBe(false)
  })

  it('sorts by money, biggest first', () => {
    const { rows, totals } = buildInFlight([
      cert({ certificate_id: 1, outstanding_amt: 14_462 }),
      cert({ certificate_id: 2, outstanding_amt: 7_015_501 }),
      cert({ certificate_id: 3, outstanding_amt: 1_116_428 }),
    ], [], NOW)
    expect(rows.map(r => r.outstanding)).toEqual([7_015_501, 1_116_428, 14_462])
    expect(totals).toEqual({ bills: 3, outstanding: 8_146_391 })
  })

  it('groups by status with the longest wait at each desk', () => {
    const { byStatus } = buildInFlight([
      cert({ certificate_id: 1, status_name: 'Approved', outstanding_amt: 100 }),
      cert({ certificate_id: 2, status_name: 'Approved', outstanding_amt: 200 }),
      cert({ certificate_id: 3, status_name: 'Verify', outstanding_amt: 50 }),
    ], [
      ev({ certificate_id: 1, at: '2026-09-04T00:00:00Z' }),   // 9 days
      ev({ certificate_id: 2, at: '2026-08-25T00:00:00Z' }),   // 19 days
    ], NOW)

    const approved = byStatus.find(s => s.status === 'Approved')!
    expect(approved).toMatchObject({ bills: 2, outstanding: 300, oldestAtDesk: 19, desk: 'Entity Trust Accounts' })
    expect(byStatus.find(s => s.status === 'Verify')!.oldestAtDesk).toBeNull()
    expect(byStatus.map(s => s.status)).toEqual(['Verify', 'Approved'])   // pipeline order, not count order
  })

  it('never shows the internal id, whatever else is missing', () => {
    // It used to fall back to '#77'. That is the DISPLAY_ID serial, meaningless
    // outside the database, and it was filling most of this screen.
    const { rows } = buildInFlight([cert({ certificate_id: 77, display_no: null })], [], NOW)
    expect(rows[0].displayNo).not.toBe('#77')
  })
})

describe('the number a person reads', () => {
  it('never falls back to the internal serial', () => {
    // Every misc certificate in IN4 has a blank ENP — 1,248 of 4,717 — and the
    // fallback used to be `#2891`, which was 63% of the screen and a number
    // nobody in the building recognises.
    const [r] = rowsOf([cert({ kind: 'misc', display_no: null, wo_no: null, invoice_no: 'CASH/2026/41' })], [], NOW)
    expect(r.displayNo).toBe('CASH/2026/41')
    expect(r.displayNo).not.toMatch(/^#/)
  })

  it('falls to the work-order number, then says so plainly', () => {
    const [a] = rowsOf([cert({ display_no: null, invoice_no: null })], [], NOW)
    expect(a.displayNo).toBe('WO/SRASSK/SQ/2026-27/105')
    const [b] = rowsOf([cert({ display_no: null, invoice_no: null, wo_no: null })], [], NOW)
    expect(b.displayNo).toBe('no number in IN4')
  })

  it('carries the kind, so a misc row is not offered a Sanction button that always fails', () => {
    // sanctionCertificate filters kind = 'wo'; pressing it on a misc row
    // returned "not in the IN4 mirror, sync and try again", which is not what
    // happened and sent people off to run a sync that changed nothing.
    const [r] = rowsOf([cert({ kind: 'MISC' })], [], NOW)
    expect(r.kind).toBe('misc')
    expect(rowsOf([cert({ kind: null })], [], NOW)[0].kind).toBe('wo')
  })
})
