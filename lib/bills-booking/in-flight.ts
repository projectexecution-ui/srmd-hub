/** Bills that are moving — and, for the first time, who is sitting on each one.
 *
 *  The certificate mirror says what state a bill is in. It cannot say who put
 *  it there or when, so "this has been with the Atm desk for nineteen days"
 *  was not a sentence CT Hub could form. The approval trail supplies the
 *  missing half: the last movement on a certificate names the person and the
 *  second, so the wait at the current desk is the gap between then and now.
 *
 *  Pure — the page fetches, this decides. */

export interface FlightCert {
  certificate_id: number
  kind: string | null
  display_no: string | null
  wo_no: string | null
  contractor_name: string | null
  project_id: number | null
  subproject_id: number | null
  status_name: string | null
  outstanding_amt: number | null
  creation_dt: string | null
}

export interface FlightEvent {
  certificate_id: number
  at: string
  status_name: string | null
  actor_name: string | null
  remark: string | null
}

/** IN4's live states, in the order a bill passes through them, with the desk
 *  that holds each one. Paid, Partially Paid, Cancelled and Reversed are not
 *  here: they are finished or dead, and a queue of finished work is noise.
 *  Hold and ReSubmit are, because a parked bill is exactly what gets lost. */
export const IN_FLIGHT: Array<{ status: string; desk: string }> = [
  { status: 'Submitted', desk: 'CT Disc Head' },
  { status: 'Verify', desk: 'Atm Head' },
  { status: 'Approved', desk: 'Entity Trust Accounts' },
  { status: 'Processed', desk: 'Entity Trust Accounts' },
  { status: 'ReSubmit', desk: 'Sent back — with the site' },
  { status: 'Hold', desk: 'Parked by Accounts' },
]
const DESK = new Map(IN_FLIGHT.map(s => [s.status.toLowerCase(), s.desk]))
export const isInFlight = (s: string | null): boolean => !!s && DESK.has(s.trim().toLowerCase())

export interface FlightRow {
  certificateId: number
  displayNo: string
  woNo: string | null
  contractor: string
  status: string
  desk: string
  outstanding: number
  /** Days since the bill was first raised. */
  age: number
  /** Days it has sat at the desk it is at now. Null when the trail has not
   *  synced yet — shown as unknown rather than guessed as zero, because zero
   *  reads as "just arrived" and would hide exactly the bills that are stuck. */
  atDesk: number | null
  movedBy: string | null
  remark: string | null
}

const daysSince = (iso: string | null, now: number): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

export interface InFlight {
  rows: FlightRow[]
  byStatus: Array<{ status: string; desk: string; bills: number; outstanding: number; oldestAtDesk: number | null }>
  totals: { bills: number; outstanding: number }
  /** False when no trail rows were supplied — the desk columns will be empty. */
  haveTrail: boolean
}

export function buildInFlight(certs: FlightCert[], events: FlightEvent[], now = Date.now()): InFlight {
  // Last movement per certificate. IN4 writes these in order and the mirror
  // keeps the timestamp to the second, so "latest" is simply the max.
  const last = new Map<number, FlightEvent>()
  for (const e of events) {
    const cur = last.get(e.certificate_id)
    if (!cur || e.at > cur.at) last.set(e.certificate_id, e)
  }

  const rows: FlightRow[] = []
  for (const c of certs) {
    if (!isInFlight(c.status_name)) continue
    const status = (c.status_name ?? '').trim()
    const ev = last.get(c.certificate_id)
    rows.push({
      certificateId: c.certificate_id,
      displayNo: c.display_no || `#${c.certificate_id}`,
      woNo: c.wo_no,
      contractor: c.contractor_name || '—',
      status,
      desk: DESK.get(status.toLowerCase()) ?? '—',
      outstanding: Number(c.outstanding_amt || 0),
      age: daysSince(c.creation_dt, now) ?? 0,
      atDesk: ev ? daysSince(ev.at, now) : null,
      movedBy: ev?.actor_name ?? null,
      remark: ev?.remark ?? null,
    })
  }

  // Biggest money first within the queue — that is the order anybody chasing
  // would work in, and it is the order the daily report already uses.
  rows.sort((a, b) => b.outstanding - a.outstanding)

  const byStatus = IN_FLIGHT.map(({ status, desk }) => {
    const g = rows.filter(r => r.status.toLowerCase() === status.toLowerCase())
    const ages = g.map(r => r.atDesk).filter((d): d is number => d != null)
    return {
      status, desk,
      bills: g.length,
      outstanding: g.reduce((s, r) => s + r.outstanding, 0),
      oldestAtDesk: ages.length ? Math.max(...ages) : null,
    }
  }).filter(s => s.bills > 0)

  return {
    rows,
    byStatus,
    totals: { bills: rows.length, outstanding: rows.reduce((s, r) => s + r.outstanding, 0) },
    haveTrail: events.length > 0,
  }
}
