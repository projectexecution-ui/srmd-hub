/** Where the money stands — bills raised and not yet paid, added up the way a
 *  head asks the question rather than listed the way a clerk files them.
 *
 *  Aksha, 16 Sep 2026, screen E of the look-and-feel preview: "Build it". Not
 *  a register — money at rest, by age, by project, by where it is in IN4, and
 *  by which CT desk is holding it once bills flow through the hub.
 *
 *  Two honesty rules, both learned the hard way on the proposal page:
 *
 *  · A contractor bill is "not yet paid" only when IN4 has NOT marked it Paid
 *    AND nothing has been paid against it. The mirror's paid-amount column is
 *    empty on 419 bills IN4 calls Paid, so reading either alone overstated the
 *    figure by ₹13.5 Cr. Both are read.
 *  · A supplier bill's status arrives as a bare code (15, 2, 8) with no name
 *    behind it, so the purchase side is kept apart and labelled "not marked
 *    paid", never merged into the contractor figure as if it meant the same.
 *
 *  Pure: the page fetches, this decides. */

import type { BbStage } from './stages'
import { stageDef, isTerminal } from './stages'

export interface UnpaidCert {
  kind: 'WO' | 'PO'
  /** creation_dt for a contractor certificate, certificate_date for a supplier one. */
  on: string | null
  gross: number
  paid: number
  status: string | null
  project: string | null
}

export interface Bucket {
  key: string
  label: string
  bills: number
  value: number
}

export interface Side {
  bills: number
  value: number
  byAge: Bucket[]
  byProject: Bucket[]
  byStatus: Bucket[]
  /** The ones to ask about first. */
  over90: { bills: number; value: number }
}

export interface MoneyAtRest {
  wo: Side
  po: Side
}

const r2 = (n: number) => Math.round(n * 100) / 100
const DEAD = new Set(['cancelled', 'reversed'])

export const AGE_BANDS = ['0–7 days', '8–14 days', '15–30 days', '31–90 days', '90+ days'] as const

export function ageBand(on: string | null, today: number): (typeof AGE_BANDS)[number] {
  if (!on) return '90+ days'
  const days = Math.floor((today - new Date(on).getTime()) / 86_400_000)
  if (days <= 7) return AGE_BANDS[0]
  if (days <= 14) return AGE_BANDS[1]
  if (days <= 30) return AGE_BANDS[2]
  if (days <= 90) return AGE_BANDS[3]
  return AGE_BANDS[4]
}

/** Contractor side: not marked Paid, nothing paid, and not a dead certificate. */
export function isUnpaidWo(c: UnpaidCert): boolean {
  const s = (c.status ?? '').trim().toLowerCase()
  return c.kind === 'WO' && !DEAD.has(s) && s !== 'paid' && !(c.paid > 0)
}

/** Supplier side: nothing paid. The status code says nothing we can name. */
export function isUnpaidPo(c: UnpaidCert): boolean {
  return c.kind === 'PO' && !(c.paid > 0)
}

function side(rows: UnpaidCert[], today: number, topProjects = 8): Side {
  const byAge = new Map<string, Bucket>()
  for (const b of AGE_BANDS) byAge.set(b, { key: b, label: b, bills: 0, value: 0 })
  const byProject = new Map<string, Bucket>()
  const byStatus = new Map<string, Bucket>()
  let bills = 0, value = 0
  const over90 = { bills: 0, value: 0 }

  for (const c of rows) {
    bills += 1; value = r2(value + c.gross)
    const band = ageBand(c.on, today)
    const a = byAge.get(band)!
    a.bills += 1; a.value = r2(a.value + c.gross)
    if (band === '90+ days') { over90.bills += 1; over90.value = r2(over90.value + c.gross) }

    const pk = c.project?.trim() || 'No project named'
    let p = byProject.get(pk)
    if (!p) { p = { key: pk, label: pk, bills: 0, value: 0 }; byProject.set(pk, p) }
    p.bills += 1; p.value = r2(p.value + c.gross)

    const sk = c.status?.trim() || 'No status'
    let s = byStatus.get(sk)
    if (!s) { s = { key: sk, label: sk, bills: 0, value: 0 }; byStatus.set(sk, s) }
    s.bills += 1; s.value = r2(s.value + c.gross)
  }

  // Biggest first, and everything past the top N folded into one line — a
  // twenty-bar chart is a table pretending.
  const projects = [...byProject.values()].sort((x, y) => y.value - x.value)
  const head = projects.slice(0, topProjects)
  const tail = projects.slice(topProjects)
  if (tail.length) {
    head.push({
      key: '__other', label: `${tail.length} other ${tail.length === 1 ? 'project' : 'projects'}`,
      bills: tail.reduce((s, b) => s + b.bills, 0),
      value: r2(tail.reduce((s, b) => s + b.value, 0)),
    })
  }

  return {
    bills, value,
    byAge: [...byAge.values()],
    byProject: head,
    byStatus: [...byStatus.values()].sort((x, y) => y.value - x.value),
    over90,
  }
}

export function moneyAtRest(certs: UnpaidCert[], today: number = Date.now()): MoneyAtRest {
  return {
    wo: side(certs.filter(isUnpaidWo), today),
    po: side(certs.filter(isUnpaidPo), today),
  }
}

/* ── by CT desk, once bills flow through the hub ─────────────────────────── */

export interface DeskBill {
  stage: BbStage
  amount: number
  isExample: boolean
}

/** Money at each CT desk right now. Examples excluded, terminal stages
 *  excluded, the desk holding most first. */
export function restByDesk(bills: DeskBill[]): Bucket[] {
  const m = new Map<BbStage, Bucket>()
  for (const b of bills) {
    if (b.isExample || isTerminal(b.stage)) continue
    let k = m.get(b.stage)
    if (!k) { k = { key: b.stage, label: stageDef(b.stage).label, bills: 0, value: 0 }; m.set(b.stage, k) }
    k.bills += 1; k.value = r2(k.value + b.amount)
  }
  return [...m.values()].sort((x, y) => y.value - x.value)
}
