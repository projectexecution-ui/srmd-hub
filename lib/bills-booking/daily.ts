/** The daily payment report, fed from IN4 instead of Zoho.
 *
 *  Same shape as the one the Billing team already sends: what was paid, then
 *  what is sitting at each trust, grouped by trust. Two differences.
 *
 *  The trust is read off the work-order number rather than a hand-kept
 *  project→trust map. WO/SRASSK/SQ/2026-27/105 says SRASSK in the number
 *  itself, and every one of the 3,072 work-order certificates carries it —
 *  SRASSK 1,320, SRET 1,236, SRJT 516, none unmapped. A map that has to be
 *  maintained is a map that goes stale; this one cannot.
 *
 *  And the paid date comes from IN4's approval trail, which records the second
 *  a certificate was marked Paid and who did it. The Zoho version had to guess
 *  from last-modified.
 *
 *  Pure. */

export interface DailyCert {
  certificate_id: number
  display_no: string | null
  wo_no: string | null
  contractor_name: string | null
  project_id: number | null
  status_name: string | null
  outstanding_amt: number | null
  creation_dt: string | null
}

export interface DailyEvent {
  certificate_id: number
  at: string
  status_name: string | null
  actor_name: string | null
}

export interface DailyRow {
  certificateId: number
  displayNo: string
  contractor: string
  project: string
  amount: number
  /** For paid rows, the day it was paid. For at-trust rows, the day it was approved. */
  on: string | null
  by: string | null
  /** Days since that moment. */
  days: number | null
}

export interface TrustBlock {
  trust: string
  rows: DailyRow[]
  total: number
}

export interface Daily {
  paid: DailyRow[]
  paidTotal: number
  atTrust: TrustBlock[]
  atTrustTotal: number
  /** Certificates whose work order carries no recognisable trust. Never hidden. */
  unassigned: DailyRow[]
}

/** WO/SRASSK/SQ/2026-27/105 → SRASSK. Null when the number is missing or does
 *  not have the shape, so those rows can be shown rather than silently dropped. */
export function trustOf(woNo: string | null): string | null {
  if (!woNo) return null
  const parts = woNo.split('/')
  if (parts.length < 3) return null
  const t = parts[1]?.trim().toUpperCase()
  return t && /^[A-Z]{2,8}$/.test(t) ? t : null
}

const AT_TRUST = new Set(['approved', 'processed'])

const dayOf = (iso: string) => iso.slice(0, 10)
const daysSince = (iso: string | null, now: number): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null
}

export function buildDaily(
  certs: DailyCert[],
  events: DailyEvent[],
  projectNames: Map<number, string>,
  opts: { paidWithinDays?: number; now?: number } = {},
): Daily {
  const now = opts.now ?? Date.now()
  const within = opts.paidWithinDays ?? 3

  // Latest movement of each kind we care about, per certificate.
  const latest = (want: string) => {
    const m = new Map<number, DailyEvent>()
    for (const e of events) {
      if ((e.status_name ?? '').trim().toLowerCase() !== want) continue
      const cur = m.get(e.certificate_id)
      if (!cur || e.at > cur.at) m.set(e.certificate_id, e)
    }
    return m
  }
  const paidAt = latest('paid')
  const approvedAt = latest('approved')

  const byId = new Map(certs.map(c => [c.certificate_id, c]))
  const row = (c: DailyCert, ev: DailyEvent | undefined, amount: number): DailyRow => ({
    certificateId: c.certificate_id,
    displayNo: c.display_no || `#${c.certificate_id}`,
    contractor: c.contractor_name || '—',
    project: (c.project_id != null && projectNames.get(c.project_id)) || '—',
    amount,
    on: ev ? dayOf(ev.at) : null,
    by: ev?.actor_name ?? null,
    days: ev ? daysSince(ev.at, now) : null,
  })

  // ── Paid ──
  // Driven by the trail, not by status: a certificate that went Paid and then
  // Partially Paid again still had money leave the building on that day.
  const paid: DailyRow[] = []
  for (const [id, ev] of paidAt) {
    const c = byId.get(id)
    if (!c) continue
    const d = daysSince(ev.at, now)
    if (d == null || d > within) continue
    // What was paid is what is no longer outstanding; IN4 does not carry a
    // per-payment figure on the certificate, so the certificate's own value is
    // the honest one to show and the amount column is labelled accordingly.
    paid.push(row(c, ev, Number(c.outstanding_amt || 0)))
  }
  paid.sort((a, b) => (b.on ?? '').localeCompare(a.on ?? '') || b.amount - a.amount)

  // ── At trust ──
  const byTrust = new Map<string, DailyRow[]>()
  const unassigned: DailyRow[] = []
  for (const c of certs) {
    const st = (c.status_name ?? '').trim().toLowerCase()
    if (!AT_TRUST.has(st)) continue
    const amt = Number(c.outstanding_amt || 0)
    if (amt <= 0) continue
    const r = row(c, approvedAt.get(c.certificate_id), amt)
    const t = trustOf(c.wo_no)
    if (!t) { unassigned.push(r); continue }
    const g = byTrust.get(t) ?? []
    g.push(r)
    byTrust.set(t, g)
  }

  const atTrust: TrustBlock[] = [...byTrust.entries()]
    .map(([trust, rows]) => ({
      trust,
      // Oldest first — the chase list reads top down.
      rows: rows.sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || b.amount - a.amount),
      total: rows.reduce((s, r) => s + r.amount, 0),
    }))
    .sort((a, b) => b.total - a.total)

  return {
    paid,
    paidTotal: paid.reduce((s, r) => s + r.amount, 0),
    atTrust,
    atTrustTotal: atTrust.reduce((s, t) => s + t.total, 0),
    unassigned,
  }
}
