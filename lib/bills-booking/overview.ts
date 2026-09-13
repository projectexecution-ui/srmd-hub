/** Rolling ~4,700 IN4 certificates up into one row per project.
 *
 *  Pure, so the arithmetic that produces the headline number is testable
 *  without a database. The page only fetches and renders. */

export interface CertRow {
  certificate_id: number
  kind: string | null
  display_no: string | null
  project_id: number | null
  wo_id: number | null
  wo_no: string | null
  status_name: string | null
  outstanding_amt: number | null
  creation_dt: string | null
}

export interface ProjectRow { id: number; name: string }

export interface OverviewRow {
  projectId: number
  project: string
  bills: number
  wos: number
  outstanding: number
  /** Days since the oldest live bill on this project was raised. */
  oldest: number
}

export interface Overview {
  rows: OverviewRow[]
  totals: { bills: number; wos: number; outstanding: number; oldest: number }
  /** Null unless the mirror has been synced since display_no/status_name landed. */
  asOf: string | null
}

/** Cancelled certificates keep a non-zero outstanding in IN4 — 83 of them carry
 *  ₹4.11 crore between them — so counting every row with a balance overstates
 *  what is actually owed by that much. They are dropped here rather than in the
 *  query: status_name is null until the first sync after the column was added,
 *  and a SQL `<> 'Cancelled'` would silently drop every null row with it,
 *  emptying the page instead of degrading. An unknown status is counted, and
 *  `asOf` tells the caller whether the statuses are trustworthy yet. */
const DEAD = new Set(['cancelled', 'reversed'])
const isDead = (s: string | null) => !!s && DEAD.has(s.trim().toLowerCase())

const daysSince = (iso: string | null, now: number): number => {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

export function rollUpProjects(certs: CertRow[], projects: ProjectRow[], now = Date.now()): Overview {
  const name = new Map(projects.map(p => [p.id, p.name]))
  const acc = new Map<number, { bills: number; wos: Set<number>; outstanding: number; oldest: number }>()
  let anyStatus = false

  for (const c of certs) {
    if (c.status_name) anyStatus = true
    if (isDead(c.status_name)) continue
    const amt = Number(c.outstanding_amt || 0)
    if (amt <= 0) continue
    const pid = c.project_id ?? 0
    let a = acc.get(pid)
    if (!a) { a = { bills: 0, wos: new Set(), outstanding: 0, oldest: 0 }; acc.set(pid, a) }
    a.bills++
    a.outstanding += amt
    if (c.wo_id) a.wos.add(c.wo_id)
    const age = daysSince(c.creation_dt, now)
    if (age > a.oldest) a.oldest = age
  }

  const rows: OverviewRow[] = [...acc.entries()]
    .map(([projectId, a]) => ({
      projectId,
      project: name.get(projectId) ?? (projectId ? `Project ${projectId}` : 'No project'),
      bills: a.bills,
      wos: a.wos.size,
      outstanding: a.outstanding,
      oldest: a.oldest,
    }))
    .sort((x, y) => y.outstanding - x.outstanding)

  const totals = {
    bills: rows.reduce((s, r) => s + r.bills, 0),
    wos: rows.reduce((s, r) => s + r.wos, 0),
    outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
    oldest: rows.reduce((s, r) => Math.max(s, r.oldest), 0),
  }

  return { rows, totals, asOf: anyStatus ? 'with statuses' : null }
}
