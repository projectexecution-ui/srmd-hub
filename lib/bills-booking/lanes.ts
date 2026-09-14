/** The two tracking lanes: retention held, and work orders nobody closed.
 *
 *  Neither is an approval chain. Nothing is blocked and nobody is queued —
 *  they are two lists that keep a clock on money the nine desks have already
 *  finished with. Both open on the part that has gone quiet and hide the rest,
 *  because the full lists are 437 and 1,009 rows and a list that long is worse
 *  than no list.
 *
 *  Pure. The pages fetch; this decides. */

export interface LaneWo {
  wo_id: number
  display_no: string | null
  contractor_id: number | null
  wo_gross_value: number | null
  status_name: string | null
}

export interface LaneCert {
  wo_id: number
  /** The work-order mirror has only a sub-project; the project id rides on the
   *  certificates, so it is carried through the roll-up. */
  project_id: number | null
  subproject_id: number | null
  certificate_type: string | null
  status_name: string | null
  gross_bill_amt: number | null
  retention_amt: number | null
  creation_dt: string | null
}

const DEAD = new Set(['cancelled', 'reversed'])
const isDead = (s: string | null) => !!s && DEAD.has(s.trim().toLowerCase())

const days = (iso: string | null, now: number): number | null => {
  if (!iso) return null
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 86_400_000)) : null
}

/** Per work order, everything both lanes need, in one pass over the certificates. */
export interface WoRoll {
  woId: number
  projectId: number | null
  retentionDeducted: number
  retentionReleased: number
  certifiedGross: number
  finals: number
  lastBill: string | null
}

export function rollCerts(certs: LaneCert[]): Map<number, WoRoll> {
  const m = new Map<number, WoRoll>()
  for (const c of certs) {
    let r = m.get(c.wo_id)
    if (!r) { r = { woId: c.wo_id, projectId: c.project_id ?? null, retentionDeducted: 0, retentionReleased: 0, certifiedGross: 0, finals: 0, lastBill: null }; m.set(c.wo_id, r) }
    const type = (c.certificate_type ?? '').trim().toLowerCase()
    // Cancelled and reversed certificates are dropped before anything is
    // counted, on both sides. A cancelled deduction was never taken, and a
    // cancelled release never went back out — counting either would move the
    // held figure in the wrong direction.
    if (isDead(c.status_name)) continue
    if (type === 'retention') r.retentionReleased += Number(c.gross_bill_amt || 0)
    if (type === 'final') r.finals++
    r.retentionDeducted += Number(c.retention_amt || 0)
    r.certifiedGross += Number(c.gross_bill_amt || 0)
    if (r.projectId == null && c.project_id != null) r.projectId = c.project_id
    if (c.creation_dt && (!r.lastBill || c.creation_dt > r.lastBill)) r.lastBill = c.creation_dt
  }
  return m
}

// ── Lane A: retention held ───────────────────────────────────────────────────

export interface RetentionRow {
  woId: number
  woNo: string
  contractorId: number | null
  projectId: number | null
  held: number
  /** Days since the last bill on this work order — the proxy for "gone quiet". */
  quiet: number | null
  hasFinal: boolean
}

export interface RetentionLane {
  rows: RetentionRow[]
  /** Ageing buckets over every row, including the ones the default view hides. */
  buckets: Array<{ band: string; wos: number; held: number }>
  totals: { wos: number; held: number }
  /** What the default view (quiet 6 months or more) covers. */
  shown: { wos: number; held: number }
  /** Held on work orders billed inside 3 months — correctly held, hidden. */
  active: { wos: number; held: number }
}

const BANDS: Array<{ band: string; min: number }> = [
  { band: 'Over 2 years', min: 730 },
  { band: '1 to 2 years', min: 365 },
  { band: '6 to 12 months', min: 180 },
  { band: '3 to 6 months', min: 90 },
  { band: 'Under 3 months', min: 0 },
]
const bandOf = (d: number | null) => (d == null ? 'Under 3 months' : BANDS.find(b => d > b.min)?.band ?? 'Under 3 months')

/** Quiet for six months or more — the slice worth a person's attention. The
 *  rest is retention correctly held on live work and is not a task. */
export const RETENTION_QUIET_DAYS = 180

export function retentionLane(wos: LaneWo[], rolls: Map<number, WoRoll>, now = Date.now()): RetentionLane {
  const rows: RetentionRow[] = []
  for (const w of wos) {
    const r = rolls.get(w.wo_id)
    if (!r) continue
    const held = r.retentionDeducted - r.retentionReleased
    if (held <= 1) continue
    rows.push({
      woId: w.wo_id,
      woNo: w.display_no || `WO ${w.wo_id}`,
      contractorId: w.contractor_id,
      projectId: r.projectId,
      held,
      quiet: days(r.lastBill, now),
      hasFinal: r.finals > 0,
    })
  }
  rows.sort((a, b) => b.held - a.held)

  const buckets = BANDS.map(({ band }) => {
    const g = rows.filter(r => bandOf(r.quiet) === band)
    return { band, wos: g.length, held: g.reduce((s, r) => s + r.held, 0) }
  }).filter(b => b.wos > 0)

  const quiet = rows.filter(r => (r.quiet ?? 0) >= RETENTION_QUIET_DAYS)
  const active = rows.filter(r => (r.quiet ?? 0) < 90)

  return {
    rows,
    buckets,
    totals: { wos: rows.length, held: rows.reduce((s, r) => s + r.held, 0) },
    shown: { wos: quiet.length, held: quiet.reduce((s, r) => s + r.held, 0) },
    active: { wos: active.length, held: active.reduce((s, r) => s + r.held, 0) },
  }
}

// ── Lane B: work orders nobody closed ────────────────────────────────────────

export interface ClosureRow {
  woId: number
  woNo: string
  contractorId: number | null
  projectId: number | null
  orderedGross: number
  neverBilled: number
  retentionHeld: number
  atStake: number
  quiet: number
}

export interface ClosureLane {
  rows: ClosureRow[]
  /** Everything over the floor. */
  shown: { wos: number; atStake: number }
  /** Everything, floor included — so the page can say what it is hiding. */
  totals: { wos: number; atStake: number }
  hidden: { wos: number; atStake: number }
}

/** No final bill and silent for four months. Shorter than that and it is just
 *  a job between bills. */
export const CLOSURE_QUIET_DAYS = 120
/** Below this a row is not worth anybody opening. 849 of the 1,009 sit under
 *  it and carry about ₹17 lakh between them; the 160 above carry 98.8% of the
 *  money. Movable by the viewer. */
export const CLOSURE_FLOOR = 25_000

export function closureLane(
  wos: LaneWo[], rolls: Map<number, WoRoll>, floor = CLOSURE_FLOOR, now = Date.now(),
): ClosureLane {
  const all: ClosureRow[] = []
  for (const w of wos) {
    const r = rolls.get(w.wo_id)
    if (!r || r.finals > 0) continue
    const quiet = days(r.lastBill, now)
    if (quiet == null || quiet <= CLOSURE_QUIET_DAYS) continue
    const ordered = Number(w.wo_gross_value || 0)
    if (ordered <= 0) continue
    const neverBilled = Math.max(0, ordered - r.certifiedGross)
    const retentionHeld = Math.max(0, r.retentionDeducted - r.retentionReleased)
    all.push({
      woId: w.wo_id,
      woNo: w.display_no || `WO ${w.wo_id}`,
      contractorId: w.contractor_id,
      projectId: r.projectId,
      orderedGross: ordered,
      neverBilled,
      retentionHeld,
      atStake: neverBilled + retentionHeld,
      quiet,
    })
  }
  all.sort((a, b) => b.atStake - a.atStake)

  const rows = all.filter(r => r.atStake >= floor)
  const under = all.filter(r => r.atStake < floor)
  const sum = (xs: ClosureRow[]) => xs.reduce((s, r) => s + r.atStake, 0)

  return {
    rows,
    shown: { wos: rows.length, atStake: sum(rows) },
    totals: { wos: all.length, atStake: sum(all) },
    hidden: { wos: under.length, atStake: sum(under) },
  }
}
