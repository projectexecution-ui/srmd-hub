// Builds one Atm Head's weekday reminder digest from the stored tracker state,
// scoped to that head's projects. Two SLA-driven reminders + since-last changes
// + a stale-upload flag. Pure — no Supabase; the cron feeds it the parsed state.
//
//   Reminder A "Raise a PO"  — no_po lines, indent ≥ noPoSlaDays old.
//                              recent (< abandonedDays) are listed; older ones
//                              collapse into an "abandoned" count.
//   Reminder B "Chase GRN"   — not-received lines, PO ≥ grnSlaDays old.

import type { StoredSnapshot, LineRecord, IndentRollup } from './types'
import { categoryLabel } from './item-subtype'
import type { ProcurementNotifyConfig } from './notify-settings'

export interface NeedPoRow {
  indentNo: string
  project: string
  category: string
  items: number
  days: number            // days since indent (age)
}
export interface AwaitRow {
  indentNo: string
  project: string
  category: string
  vendor: string | null
  items: number
  poDays: number          // days since oldest PO
  value: number           // sum of pending value
}
export interface ProcurementDigest {
  projects: string[]
  asOf: string            // savedAt of the current upload
  fileName: string
  needPo: { count: number; rows: NeedPoRow[]; more: number; abandoned: number } | null
  awaiting: { count: number; value: number; rows: AwaitRow[]; more: number } | null
  changes: { received: number; newPos: number; newNoPo: number } | null
  stale: { lastUploadAt: string } | null
}

const DAY = 86_400_000

function shortIndent(no: string): string {
  const parts = String(no).split('/')
  return parts.length >= 3 ? parts.slice(2).join('/') : no
}
const age = (l: LineRecord) => l.indentAgeDays ?? 0
const poAge = (l: LineRecord) => l.oldestPoAgeDays ?? 0

/** Dominant discipline across a group of lines (for the category label). */
function dominantDiscipline(lines: LineRecord[]): string {
  const c = new Map<string, number>()
  for (const l of lines) c.set(l.discipline, (c.get(l.discipline) ?? 0) + 1)
  let best = lines[0]?.discipline ?? '', n = 0
  for (const [d, k] of c) if (k > n) { best = d; n = k }
  return best
}

/** Group lines by indent → one display row via `make`, sorted by `weight` desc. */
function groupByIndent<T>(
  lines: LineRecord[],
  make: (indentNo: string, group: LineRecord[]) => T,
  weight: (row: T) => number,
): T[] {
  const byIndent = new Map<string, LineRecord[]>()
  for (const l of lines) {
    const arr = byIndent.get(l.indentNo) ?? []
    arr.push(l)
    byIndent.set(l.indentNo, arr)
  }
  const rows = [...byIndent.entries()].map(([no, g]) => make(no, g))
  rows.sort((a, b) => weight(b) - weight(a))
  return rows
}

export function buildHeadDigest(
  current: StoredSnapshot,
  baseline: StoredSnapshot | null,
  cfg: ProcurementNotifyConfig,
  nowMs: number,
  projectNames: string[],
): ProcurementDigest | null {
  const scope = new Set(projectNames)
  const projects = (current.projects ?? []).filter(p =>
    scope.has((p.lines?.[0]?.project) ?? '') || p.lines?.some(l => scope.has(l.project)))
  const lines: LineRecord[] = (current.projects ?? [])
    .flatMap(p => p.lines ?? [])
    .filter(l => scope.has(l.project))
  const indents: IndentRollup[] = (current.projects ?? [])
    .flatMap(p => p.indents ?? [])
    .filter(i => scope.has(i.project))
  void projects

  // ── Reminder A: raise a PO ────────────────────────────────────────────
  let needPo: ProcurementDigest['needPo'] = null
  if (cfg.sections.needsPo) {
    const noPo = lines.filter(l => l.status === 'no_po' && age(l) >= cfg.noPoSlaDays)
    const recent = noPo.filter(l => age(l) < cfg.abandonedDays)
    const abandoned = noPo.length - recent.length
    const rowsAll = groupByIndent(
      recent,
      (no, g) => ({
        indentNo: shortIndent(no),
        project: g[0].project,
        category: categoryLabel(dominantDiscipline(g), g.map(x => x.material)),
        items: g.length,
        days: Math.max(...g.map(age)),
      }),
      r => r.days,
    )
    if (rowsAll.length > 0 || abandoned > 0) {
      needPo = {
        count: rowsAll.length,
        rows: rowsAll.slice(0, cfg.listLen),
        more: Math.max(0, rowsAll.length - cfg.listLen),
        abandoned,
      }
    }
  }

  // ── Reminder B: chase delivery / GRN ─────────────────────────────────
  let awaiting: ProcurementDigest['awaiting'] = null
  if (cfg.sections.awaiting) {
    const pend = lines.filter(l =>
      l.pendingQty > 0 && (l.status === 'pending' || l.status === 'partial') && poAge(l) >= cfg.grnSlaDays)
    const rowsAll = groupByIndent(
      pend,
      (no, g) => ({
        indentNo: shortIndent(no),
        project: g[0].project,
        category: categoryLabel(dominantDiscipline(g), g.map(x => x.material)),
        vendor: (g.find(x => x.supplier)?.supplier) || null,
        items: g.length,
        poDays: Math.max(...g.map(poAge)),
        value: g.reduce((s, x) => s + (x.pendingValue || 0), 0),
      }),
      r => r.value,
    )
    if (rowsAll.length > 0) {
      awaiting = {
        count: rowsAll.length,
        value: rowsAll.reduce((s, r) => s + r.value, 0),
        rows: rowsAll.slice(0, cfg.listLen),
        more: Math.max(0, rowsAll.length - cfg.listLen),
      }
    }
  }

  // ── Since last upload (scoped) ────────────────────────────────────────
  let changes: ProcurementDigest['changes'] = null
  if (cfg.sections.changes && baseline) {
    const prevIndent = new Map((baseline.indentStatuses ?? []).map(i => [i.indentNo, i.status]))
    const prevLine = new Set((baseline.lineStatuses ?? []).map(l => l.id))
    let received = 0, newPos = 0, newNoPo = 0
    for (const ind of indents) {
      const prev = prevIndent.get(ind.indentNo)
      if (prev && prev !== ind.status) {
        if (ind.status === 'PO Done & GRN Received') received++
        else if (prev === 'Indent Only – No PO' && ind.status === 'PO Raised – GRN Pending') newPos++
      }
    }
    for (const l of lines) {
      if (!prevLine.has(l.id) && l.status === 'no_po') newNoPo++
    }
    if (received || newPos || newNoPo) changes = { received, newPos, newNoPo }
  }

  // ── Stale upload flag (global, same for all heads) ────────────────────
  let stale: ProcurementDigest['stale'] = null
  if (cfg.sections.staleAlert) {
    const savedMs = Date.parse(current.savedAt)
    if (Number.isFinite(savedMs) && nowMs - savedMs > 30 * DAY / 24) {
      stale = { lastUploadAt: current.savedAt }
    }
  }

  const hasChase = (needPo?.count ?? 0) > 0 || (awaiting?.count ?? 0) > 0
  if (cfg.skipIfEmpty && !hasChase && !changes && !stale) return null
  if (!needPo && !awaiting && !changes && !stale) return null

  return {
    projects: projectNames,
    asOf: current.savedAt,
    fileName: current.fileName,
    needPo,
    awaiting,
    changes,
    stale,
  }
}

// ── Subject + plain-text fallback (the HTML card renders from the data) ────
const inrShort = (n: number): string => {
  const v = Math.round(n || 0)
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, '')} Cr`
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(1).replace(/\.0$/, '')} L`
  return `₹${v.toLocaleString('en-IN')}`
}

export function digestSubject(d: ProcurementDigest): string {
  const bits: string[] = []
  if (d.needPo?.count) bits.push(`${d.needPo.count} PO${d.needPo.count === 1 ? '' : 's'} to raise`)
  if (d.awaiting?.count) bits.push(`${d.awaiting.count} deliveries pending (${inrShort(d.awaiting.value)})`)
  return `Reminders · ${bits.join(' · ') || 'your projects'}`
}

export function digestText(d: ProcurementDigest): string {
  const l: string[] = [`Your projects: ${d.projects.join(', ')}.`]
  if (d.needPo?.count) l.push(`${d.needPo.count} indent(s) approved 2+ days ago still have no PO — raise them.`)
  if (d.needPo?.abandoned) l.push(`${d.needPo.abandoned} no-PO item(s) are 90+ days old — likely abandoned, worth closing.`)
  if (d.awaiting?.count) l.push(`${d.awaiting.count} indent(s), ${inrShort(d.awaiting.value)}, ordered a week+ ago and not received — chase delivery.`)
  if (d.changes) l.push(`Since last upload: ${d.changes.received} received, ${d.changes.newPos} new POs, ${d.changes.newNoPo} new no-PO.`)
  if (d.stale) l.push(`Note: no fresh upload since ${new Date(d.stale.lastUploadAt).toLocaleString('en-IN')} — numbers may be stale.`)
  l.push('Open the Indent → PO Tracker for the full list.')
  return l.join('\n')
}
