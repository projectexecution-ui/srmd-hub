// The Indents board — what a project stakeholder sees first. Pure helpers over
// the tree that lib/revamp/indents-tree.ts builds from IN4, so the layout
// (one pipeline strip, one list grouped the way the old Indent → PO tracker
// grouped it — by supplier, by indent, by category — with age bands, a search
// box and a "chase first" shortlist) is tested on fixtures, not eyeballed.
//
// Aksha, 10 Sep 2026: "garbage free and more management friendly … take
// inspiration from the Indent to PO tracker and other online softwares."
// What those do well: ONE headline row of numbers with money on it, a flat
// list grouped and collapsed, ageing as bands you can click, and the record
// only when asked for.

import type { IndentRow, IndentItem, IndentsCatRow, IndentFilter, PendingApproval } from './indents-tree'
import { itemMatches } from './indents-tree'

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

export function inAgeBand(row: BoardRow, band: AgeBand): boolean {
  return band === 'all' || ageBandOf(row.item.waitingDays) === band
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

/* ── Grouping ───────────────────────────────────────────────────────────── */

export type GroupKey = 'supplier' | 'indent' | 'category' | 'project' | 'none'
export const GROUP_LABEL: Record<GroupKey, string> = { supplier: 'Supplier', indent: 'Indent', category: 'Category', project: 'Project', none: 'Flat list' }
export const isGroupKey = (v: unknown): v is GroupKey => v === 'supplier' || v === 'indent' || v === 'category' || v === 'project' || v === 'none'

/** Which grouping a stage opens on: deliveries are chased with the supplier, POs are raised per indent. */
export function defaultGroup(filter: IndentFilter, manyProjects = false): GroupKey {
  if (filter === 'delivery' || filter === 'done') return 'supplier'
  if (filter === 'po' || filter === 'late' || filter === 'approval') return 'indent'
  return manyProjects ? 'project' : 'category'
}

/** The groupings that make sense for a stage (the pills). */
export function groupOptions(filter: IndentFilter, manyProjects = false): GroupKey[] {
  const base: GroupKey[] = filter === 'delivery' || filter === 'done' ? ['supplier', 'indent', 'category'] : filter === 'all' ? ['category', 'indent'] : ['indent', 'supplier', 'category']
  const withProject = manyProjects ? [...base.filter(g => g !== 'none'), 'project' as GroupKey] : base
  return filter === 'all' ? withProject : [...withProject, 'none']
}

export interface Group {
  key: string
  label: string
  /** A second line for the header: the indent's date and who raised it, the supplier's PO count. */
  sub: string | null
  rows: BoardRow[]
  value: number
  oldest: number | null
  late: number
}

/** The supplier a line waits on: the PO that is not yet delivered or approved, else the last one. */
export function supplierOf(it: IndentItem): string | null {
  const open = it.pos.find(p => p.stage !== 'approved') ?? it.pos.find(p => p.grnQty + 0.001 < p.qty) ?? it.pos[it.pos.length - 1]
  return open?.supplier ?? null
}

export function groupRows(rows: readonly BoardRow[], key: GroupKey): Group[] {
  const byLate = (a: BoardRow, b: BoardRow) => (b.item.waitingDays ?? 0) - (a.item.waitingDays ?? 0) || pendingValue(b.item) - pendingValue(a.item)
  if (key === 'none') {
    const all = [...rows].sort(byLate)
    return all.length ? [finish({ key: 'all', label: `${all.length} line${all.length === 1 ? '' : 's'}`, sub: null, rows: all })] : []
  }
  const map = new Map<string, { key: string; label: string; sub: string | null; rows: BoardRow[] }>()
  for (const r of rows) {
    let k: string, label: string, sub: string | null = null
    switch (key) {
      case 'supplier': k = supplierOf(r.item) ?? '—'; label = k === '—' ? 'No supplier yet' : k; break
      case 'indent': k = `i${r.indent.id}`; label = shortRef(r.indent.ref); sub = [r.indent.raisedBy, r.indent.subproject ?? r.indent.project].filter(Boolean).join(' · ') || null; break
      case 'category': k = r.category; label = cleanName(r.category); break
      case 'project': k = r.indent.project ?? '—'; label = k === '—' ? 'No project on the indent' : k; break
      default: k = 'all'; label = 'All'
    }
    const g = map.get(k) ?? { key: k, label, sub, rows: [] }
    g.rows.push(r)
    map.set(k, g)
  }
  const out = [...map.values()].map(g => { g.rows.sort(byLate); return finish(g) })
  if (key === 'supplier') for (const g of out) {
    const pos = new Set(g.rows.flatMap(r => r.item.pos.filter(p => p.grnQty + 0.001 < p.qty || p.stage !== 'approved').map(p => p.poId)))
    g.sub = pos.size ? `${pos.size} PO${pos.size === 1 ? '' : 's'}` : null
  }
  // Most money stuck first, then the longest wait — what a head reads top-down.
  return out.sort((a, b) => b.value - a.value || (b.oldest ?? 0) - (a.oldest ?? 0) || a.label.localeCompare(b.label))
}

function finish(g: { key: string; label: string; sub: string | null; rows: BoardRow[] }): Group {
  return {
    ...g,
    value: g.rows.reduce((t, r) => t + pendingValue(r.item), 0),
    oldest: g.rows.reduce<number | null>((m, r) => (r.item.waitingDays == null ? m : m == null ? r.item.waitingDays : Math.max(m, r.item.waitingDays)), null),
    late: g.rows.filter(r => r.item.late).length,
  }
}

/* ── Search ─────────────────────────────────────────────────────────────── */

const norm = (v: string | null | undefined) => (v ?? '').toLowerCase()

/** Does the line answer a typed search — material, indent, PO, supplier, category, who raised it, project? */
export function rowMatchesQuery(r: BoardRow, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [r.item.material, r.indent.ref, r.indent.raisedBy, r.indent.woNo, r.indent.project, r.indent.subproject, r.category, r.subcategory,
    ...r.item.pos.flatMap(p => [p.poNo, p.supplier])].map(norm).join(' | ')
  return needle.split(/\s+/).every(w => hay.includes(w))
}

export function searchRows(rows: readonly BoardRow[], q: string | undefined): BoardRow[] {
  return q?.trim() ? rows.filter(r => rowMatchesQuery(r, q)) : [...rows]
}

export function indentMatchesQuery(r: IndentRow, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [r.ref, r.raisedBy, r.woNo, r.project, r.subproject, r.remarks, r.materialType, r.status,
    ...r.items.map(i => i.material), ...r.pos.flatMap(p => [p.poNo, p.supplier])].map(norm).join(' | ')
  return needle.split(/\s+/).every(w => hay.includes(w))
}

/* ── The lines for a stage ──────────────────────────────────────────────── */

export function stageRows(rows: readonly BoardRow[], filter: IndentFilter): BoardRow[] {
  return rows.filter(r => itemMatches(filter, r.item))
}

/** The few worth chasing first: most money stuck, then longest waiting. */
export function chaseFirst(rows: readonly BoardRow[], n = 5): BoardRow[] {
  return [...rows].sort((a, b) => pendingValue(b.item) - pendingValue(a.item) || (b.item.waitingDays ?? 0) - (a.item.waitingDays ?? 0)).slice(0, n)
}

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

/* ── All indents, each once ─────────────────────────────────────────────── */

export interface IndentGroup { key: string; label: string; indents: IndentRow[]; poValue: number; open: number }

/** The tree's parts merged back into whole indents, grouped by category or project; an indent spanning two categories appears under both, as the Internal Estimate files it. */
export function indentGroups(cats: readonly IndentsCatRow[], key: 'category' | 'project' | 'indent', q?: string): IndentGroup[] {
  const groups = new Map<string, IndentGroup>()
  const add = (gk: string, label: string, part: IndentRow) => {
    const g = groups.get(gk) ?? { key: gk, label, indents: [], poValue: 0, open: 0 }
    const cur = g.indents.find(x => x.id === part.id)
    if (cur) {
      const ids = new Set(cur.items.map(i => i.id))
      const extra = part.items.filter(i => !ids.has(i.id))
      cur.items = [...cur.items, ...extra]
      cur.poValue += extra.reduce((t, i) => t + i.poValue, 0); cur.receivedValue += extra.reduce((t, i) => t + i.receivedValue, 0)
      cur.awaitingPo += extra.filter(i => i.next === 'raise PO').length; cur.awaitingDelivery += extra.filter(i => i.next === 'delivery' || i.next === 'PO approval').length
    } else g.indents.push({ ...part, items: [...part.items] })
    groups.set(gk, g)
  }
  for (const c of cats) for (const sb of c.subs) for (const r of sb.indents) {
    if (key === 'category') add(c.id, cleanName(c.name), r)
    else if (key === 'project') add(r.project ?? '—', r.project ?? 'No project on the indent', r)
    else add('all', 'All indents', r)
  }
  const out = [...groups.values()]
  for (const g of out) {
    if (q?.trim()) g.indents = g.indents.filter(r => indentMatchesQuery(r, q))
    g.indents.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    g.poValue = g.indents.reduce((t, r) => t + r.poValue, 0)
    g.open = g.indents.reduce((t, r) => t + r.awaitingPo + r.awaitingDelivery + (r.stage === 'verify' || r.stage === 'submitted' ? 1 : 0), 0)
  }
  return out.filter(g => g.indents.length > 0).sort((a, b) => b.open - a.open || b.poValue - a.poValue || a.label.localeCompare(b.label))
}

/* ── URL state ──────────────────────────────────────────────────────────── */

export interface BoardParams { f?: string; q?: string; g?: string; age?: string; p?: string; months?: string }

/** The board's URL with some parameters changed; empty values drop the key. */
export function boardHref(base: string, current: BoardParams, patch: Partial<BoardParams>): string {
  const merged: Record<string, string | undefined> = { ...current, ...patch }
  const qs = new URLSearchParams()
  for (const k of ['p', 'months', 'f', 'g', 'age', 'q'] as const) {
    const v = merged[k]
    if (v && !(k === 'f' && v === 'all') && !(k === 'age' && v === 'all')) qs.set(k, v)
  }
  const str = qs.toString()
  return str ? `${base}?${str}` : base
}
