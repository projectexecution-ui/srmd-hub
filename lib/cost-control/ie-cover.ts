// Internal Estimate cover at sign-off — shapes and the small pure helpers the
// sign-off box needs. The arithmetic itself lives in the database
// (fn_cc_ie_rows / cc_ie_position) so the screen, the gate and Telegram can
// never disagree. Internal Estimate is management-only: these shapes only ever
// reach a Project Head, Atm Head, Trustee, coordinator or admin.

export interface IeRow {
  sub_skill_id: string
  code: string | null
  name: string | null
  /** Internal Estimate on this sub-category. */
  ie: number
  /** True when the figure was set on the budget line (a person, or mirrored
   *  from ERP); false when it comes from the imported [IB…] baseline. */
  ie_set: boolean
  approved: number
  /** What requests still waiting on this sub-category ask for. */
  pending: number
  /** ie − approved − pending. Negative = already short. */
  spare: number
  is_this: boolean
}

export interface IeMove {
  at: string
  actor: string | null
  /** null = new Internal Estimate, not taken from anywhere. */
  from: string | null
  to: string | null
  amount: number
  stage: 'project_head' | 'atm_head' | 'admin' | string
  note: string | null
}

export interface IePosition {
  applies: boolean
  status?: string
  sub_skill_id?: string
  discipline?: string | null
  ie?: number
  ie_set?: boolean
  approved?: number
  pending?: number
  /** What this request still asks for (total − released on it). */
  ask?: number
  shortfall?: number
  can_cover?: boolean
  cover_block?: string | null
  rows?: IeRow[]
  moves?: IeMove[]
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Normalise the RPC's jsonb into typed numbers (Postgres numerics arrive as
 *  strings or numbers depending on the driver). Unknown / failed → not shown. */
export function parseIePosition(raw: unknown): IePosition | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.applies !== true) return { applies: false }
  const rows = Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]).map(x => ({
    sub_skill_id: String(x.sub_skill_id ?? ''),
    code: (x.code as string | null) ?? null,
    name: (x.name as string | null) ?? null,
    ie: num(x.ie),
    ie_set: x.ie_set === true,
    approved: num(x.approved),
    pending: num(x.pending),
    spare: num(x.spare),
    is_this: x.is_this === true,
  })) : []
  const moves = Array.isArray(r.moves) ? (r.moves as Record<string, unknown>[]).map(m => ({
    at: String(m.at ?? ''),
    actor: (m.actor as string | null) ?? null,
    from: (m.from as string | null) ?? null,
    to: (m.to as string | null) ?? null,
    amount: num(m.amount),
    stage: String(m.stage ?? ''),
    note: (m.note as string | null) ?? null,
  })) : []
  return {
    applies: true,
    status: r.status as string | undefined,
    sub_skill_id: r.sub_skill_id as string | undefined,
    discipline: (r.discipline as string | null) ?? null,
    ie: num(r.ie),
    ie_set: r.ie_set === true,
    approved: num(r.approved),
    pending: num(r.pending),
    ask: num(r.ask),
    shortfall: num(r.shortfall),
    can_cover: r.can_cover === true,
    cover_block: (r.cover_block as string | null) ?? null,
    rows,
    moves,
  }
}

/** Sub-categories of the same category that have spare Internal Estimate to
 *  give — largest spare first, never this request's own sub-category. */
export function donorRows(pos: IePosition): IeRow[] {
  return (pos.rows ?? [])
    .filter(r => !r.is_this && r.spare >= 1)
    .sort((a, b) => b.spare - a.spare)
}

/** Pre-fill: take the gap from the donors with the most spare first; whatever
 *  they cannot cover becomes new Internal Estimate. Pure, so it is tested. */
export function suggestCover(shortfall: number, donors: IeRow[]): { takes: Record<string, number>; addNew: number } {
  let left = Math.max(0, Math.round(shortfall))
  const takes: Record<string, number> = {}
  for (const d of donors) {
    if (left <= 0) break
    const t = Math.min(left, Math.floor(d.spare))
    if (t > 0) { takes[d.sub_skill_id] = t; left -= t }
  }
  return { takes, addNew: left }
}

/** "1203 Internal Partitions" — code and name, as the identity block shows. */
export function rowLabel(r: Pick<IeRow, 'code' | 'name'>): string {
  return [r.code, r.name].filter(Boolean).join(' ') || 'Sub-category'
}
