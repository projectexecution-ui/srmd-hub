// The Indents board — what a project stakeholder sees first. Pure helpers over
// the tree that lib/revamp/indents-tree.ts builds from IN4, so the layout
// (one pipeline strip with money on it; then the Internal Estimate's tree —
// category → sub-category → indent → items with Qty · Unit · Rate · Amount;
// age bands and a search box on top) is tested on fixtures, not eyeballed.
//
// Aksha, 10 Sep 2026: "garbage free and more management friendly", then
// "it should be in Tree View, also in Table with Qty rate etc so all are in
// the same format as IE."

import type { IndentRow, IndentItem, IndentsCatRow, IndentsSubRow, IndentFilter, PendingApproval, ChainStep } from './indents-tree'
import { itemMatches, filterIndentsTreeBy } from './indents-tree'

/* ── Lines ──────────────────────────────────────────────────────────────── */

export interface BoardRow {
  item: IndentItem
  indent: IndentRow
  category: string
  subcategory: string
}

/** Every unique indent line in the tree, remembering the category it is filed under. */
export function flattenRows(cats: readonly IndentsCatRow[]): BoardRow[] {
  const seen = new Set<string>()
  const out: BoardRow[] = []
  for (const c of cats) for (const sb of c.subs) for (const r of sb.indents) for (const item of r.items) {
    const k = `${r.id}:${item.id}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ item, indent: r, category: c.name, subcategory: sb.name })
  }
  return out
}

/** "IND/SRASSK/NGH/2026-27/151" → "NGH/2026-27/151" — the trust prefix says nothing on a project page. */
export const shortRef = (ref: string | null | undefined) => String(ref ?? '').replace(/^(IND|PO|GRN|WO)\/[A-Z0-9]+\//, '')

/** ₹ still to arrive on a line: the undelivered share of what was ordered (landed, with GST). */
export const pendingValue = (it: IndentItem) => (it.poQty > 0 ? it.poValue * Math.max(0, it.poQty - it.receivedQty) / it.poQty : 0)

/** The category name without IN4's leading code ("09 Fire Fighting Works" → "Fire Fighting Works"). */
export const cleanName = (name: string) => name.replace(/^\d+\s+/, '')

/** The supplier a line waits on: the PO not yet approved or delivered, else the last one. */
export function supplierOf(it: IndentItem): string | null {
  const open = it.pos.find(p => p.stage !== 'approved') ?? it.pos.find(p => p.grnQty + 0.001 < p.qty) ?? it.pos[it.pos.length - 1]
  return open?.supplier ?? null
}

/** IN4's net rate on the line — the one PO's rate, or the quantity-weighted rate across several. Null before a PO. */
export function lineRate(it: IndentItem): number | null {
  const priced = it.pos.filter(p => p.rate != null && p.qty > 0)
  if (priced.length === 0) return null
  const q = priced.reduce((t, p) => t + p.qty, 0)
  return q > 0 ? priced.reduce((t, p) => t + (p.rate as number) * p.qty, 0) / q : null
}

/* ── Age bands (the old tracker's signature) ────────────────────────────── */

export type AgeBand = 'all' | 'lt7' | '7to14' | '14to30' | '30plus'
export const AGE_BANDS: ReadonlyArray<{ key: AgeBand; label: string }> = [
  { key: 'all', label: 'Any age' },
  { key: 'lt7', label: 'Under 7 days' },
  { key: '7to14', label: '7–14 days' },
  { key: '14to30', label: '14–30 days' },
  { key: '30plus', label: '30+ days' },
]
export const isAgeBand = (v: unknown): v is AgeBand => AGE_BANDS.some(b => b.key === v)

export function ageBandOf(days: number | null): Exclude<AgeBand, 'all'> {
  const d = days ?? 0
  return d < 7 ? 'lt7' : d < 14 ? '7to14' : d < 30 ? '14to30' : '30plus'
}

export function inAgeBand(it: IndentItem, band: AgeBand): boolean {
  return band === 'all' || ageBandOf(it.waitingDays) === band
}

export function bandCounts(rows: readonly BoardRow[]): Record<AgeBand, { count: number; value: number }> {
  const mk = () => ({ count: 0, value: 0 })
  const out: Record<AgeBand, { count: number; value: number }> = { all: mk(), lt7: mk(), '7to14': mk(), '14to30': mk(), '30plus': mk() }
  for (const r of rows) {
    const v = pendingValue(r.item)
    out.all.count++; out.all.value += v
    const b = ageBandOf(r.item.waitingDays)
    out[b].count++; out[b].value += v
  }
  return out
}

/* ── Search ─────────────────────────────────────────────────────────────── */

const norm = (v: string | null | undefined) => (v ?? '').toLowerCase()

/** Does the line answer a typed search — material, indent, PO, supplier, category, who raised it, project? Every word must match. */
export function lineMatchesQuery(it: IndentItem, r: IndentRow, q: string, category = '', subcategory = ''): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [it.material, r.ref, r.raisedBy, r.woNo, r.project, r.subproject, r.remarks, category, subcategory,
    ...it.pos.flatMap(p => [p.poNo, p.supplier])].map(norm).join(' | ')
  return needle.split(/\s+/).every(w => hay.includes(w))
}

export function rowMatchesQuery(r: BoardRow, q: string): boolean {
  return lineMatchesQuery(r.item, r.indent, q, r.category, r.subcategory)
}

export function searchRows(rows: readonly BoardRow[], q: string | undefined): BoardRow[] {
  return q?.trim() ? rows.filter(r => rowMatchesQuery(r, q)) : [...rows]
}

/* ── The lines for a stage ──────────────────────────────────────────────── */

export function stageRows(rows: readonly BoardRow[], filter: IndentFilter): BoardRow[] {
  return rows.filter(r => itemMatches(filter, r.item))
}

/** The Internal-Estimate-shaped tree with only the lines the stage, the search and the age band keep. */
export function boardTree(cats: readonly IndentsCatRow[], filter: IndentFilter, q: string | undefined, age: AgeBand): IndentsCatRow[] {
  if (filter === 'all' && !q?.trim() && age === 'all') return [...cats]
  return filterIndentsTreeBy(cats, (it, r, c, sb) => itemMatches(filter, it) && inAgeBand(it, age) && (!q?.trim() || lineMatchesQuery(it, r, q, c.name, sb.name)))
}

export interface TreeTotals { indents: number; items: number; open: number; poValue: number; receivedValue: number; toCome: number; late: number; oldest: number | null }

/** Roll-up for a category, a sub-category, an indent, or the whole tree. Pure. */
export function rollUp(indents: readonly IndentRow[]): TreeTotals {
  const seen = new Set<string>()
  const items: IndentItem[] = []
  for (const r of indents) for (const it of r.items) { const k = `${r.id}:${it.id}`; if (!seen.has(k)) { seen.add(k); items.push(it) } }
  const waiting = items.filter(i => i.next !== 'done' && i.next !== 'closed')
  return {
    indents: new Set(indents.map(r => r.id)).size, items: items.length,
    open: waiting.length,
    poValue: items.reduce((t, i) => t + i.poValue, 0),
    receivedValue: items.reduce((t, i) => t + i.receivedValue, 0),
    toCome: items.reduce((t, i) => t + pendingValue(i), 0),
    late: items.filter(i => i.late).length,
    oldest: waiting.reduce<number | null>((m, i) => (i.waitingDays == null ? m : m == null ? i.waitingDays : Math.max(m, i.waitingDays)), null),
  }
}

export const subTotals = (sb: IndentsSubRow) => rollUp(sb.indents)
export const catTotals = (c: IndentsCatRow) => rollUp(c.subs.flatMap(sb => sb.indents))
export const treeTotals = (cats: readonly IndentsCatRow[]) => rollUp(cats.flatMap(c => c.subs.flatMap(sb => sb.indents)))

/* ── The headline: Indent → PO → GRN as numbers ─────────────────────────── */

export interface Headline {
  approval: { count: number; oldest: number | null; late: number }
  po: { count: number; oldest: number | null; late: number }
  delivery: { count: number; value: number; oldest: number | null; late: number }
  received: { count: number; value: number }
  late: { count: number; value: number }
  ordered: { value: number; pos: number }
}

const oldestOf = (rows: readonly BoardRow[]) => rows.reduce<number | null>((m, r) => (r.item.waitingDays == null ? m : m == null ? r.item.waitingDays : Math.max(m, r.item.waitingDays)), null)
const daysBetween = (iso: string | null, nowMs: number) => (iso ? Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 86400000)) : null)

export function headline(rows: readonly BoardRow[], pending: readonly PendingApproval[], now: number = Date.now()): Headline {
  const po = stageRows(rows, 'po'), delivery = stageRows(rows, 'delivery'), done = stageRows(rows, 'done'), late = rows.filter(r => r.item.late)
  const pendingDays = pending.map(p => daysBetween(p.since, now)).filter((d): d is number => d != null)
  const posSeen = new Set<number>()
  let ordered = 0
  for (const r of rows) for (const p of r.item.pos) { ordered += p.value; posSeen.add(p.poId) }
  return {
    approval: { count: pending.length, oldest: pendingDays.length ? Math.max(...pendingDays) : null, late: pendingDays.filter(d => d > 2).length },
    po: { count: po.length, oldest: oldestOf(po), late: po.filter(r => r.item.late).length },
    delivery: { count: delivery.length, value: delivery.reduce((t, r) => t + pendingValue(r.item), 0), oldest: oldestOf(delivery), late: delivery.filter(r => r.item.late).length },
    received: { count: done.length, value: done.reduce((t, r) => t + r.item.receivedValue, 0) },
    late: { count: late.length, value: late.reduce((t, r) => t + pendingValue(r.item), 0) },
    ordered: { value: ordered, pos: posSeen.size },
  }
}

/* ── URL state ──────────────────────────────────────────────────────────── */

export interface BoardParams { f?: string; q?: string; age?: string; p?: string; months?: string; g?: string }

/** The board's URL with some parameters changed; empty values drop the key. */
export function boardHref(base: string, current: BoardParams, patch: Partial<BoardParams>): string {
  const merged: Record<string, string | undefined> = { ...current, ...patch }
  const qs = new URLSearchParams()
  for (const k of ['p', 'months', 'f', 'age', 'q'] as const) {
    const v = merged[k]
    if (v && !(k === 'f' && v === 'all') && !(k === 'age' && v === 'all')) qs.set(k, v)
  }
  const str = qs.toString()
  return str ? `${base}?${str}` : base
}

/* ── The history, as milestones ─────────────────────────────────────────── */

export interface Milestone {
  /** What happened, in one word a head reads: Raised · Verified · Approved · Sent back · Amended · Cancelled. */
  label: string
  at: string | null
  by: string | null
  /** Only when the remark says something ("Ok" and "Checked and found OK" do not). */
  remark: string | null
  /** The same step repeated back to back — "Amended ×2". */
  times: number
}

const TRIVIAL_REMARK = /^\s*(ok(ay)?|fine|approved|checked( and| &)? (found |verif(y|ied) )?ok|done|yes|noted|verified|good)\s*[.!]*\s*$/i
export const meaningfulRemark = (remark: string | null | undefined): string | null => {
  const r = (remark ?? '').trim()
  return r && !TRIVIAL_REMARK.test(r) ? r : null
}

/** IN4's audit trail (Draft → Submitted → Verify → Approved, with ReSubmit and Amended loops) folded into the few steps a reader needs. Pure. */
export function summariseChain(chain: readonly ChainStep[]): Milestone[] {
  const out: Milestone[] = []
  const push = (label: string, c: ChainStep) => {
    const last = out[out.length - 1]
    const remark = meaningfulRemark(c.remark)
    if (last && last.label === label && last.by === c.by && !remark && !last.remark) { last.times++; last.at = c.at ?? last.at; return }
    out.push({ label, at: c.at, by: c.by, remark, times: 1 })
  }
  let amending = false
  for (const c of chain) {
    const st = c.status.toLowerCase()
    if (st.startsWith('amended')) {
      // The amendment loop (Amended & Draft → & Submitted → & Verify → & Approved)
      // is one event with an outcome, not four.
      if (st.includes('draft')) { amending = true; push('Amended', c) }
      else if (st.includes('approved')) { push('Approved', c); amending = false }
      else if (st.includes('verify') && !amending) push('Verified', c)
      continue
    }
    if (c.stage === 'draft') push('Raised', c)
    else if (c.stage === 'submitted' && st.includes('resubmit')) push('Sent back', c)
    else if (c.stage === 'submitted') { if (!out.some(m => m.label === 'Raised')) push('Raised', c) }
    else if (c.stage === 'verify') push('Verified', c)
    else if (c.stage === 'approved') push('Approved', c)
    else push(c.status, c)
  }
  return out
}
