// The mind map's five reports.
//
// Four of them are the SAME gate entries read four ways, not four separate
// systems — which is the whole reason they can never disagree with each other
// or with the register they come from:
//
//   Vendor IN    what each vendor brought          direction in  · register vendor
//   Vendor OUT   what went back to a vendor         direction out · register vendor
//   SRM IN       purchases taken into our stock     direction in  · register srm
//   SRM OUT      issued to sites, with qty/rate/amt direction out · register srm
//
// The fifth, Total Stock, is the stock screen: "what lies where as on a date"
// is a balance, not a list of entries, and it already exists.
//
// Pure. The reading lives in queries.ts; what is worth testing is the
// filtering, the grouping and the totals, and those live here.

import { fmtQty, type Register } from './core'

export type RegisterKind = 'vendor-in' | 'vendor-out' | 'srm-in' | 'srm-out'

export interface RegisterSpec {
  kind: RegisterKind
  title: string
  /** What it answers, in one line, shown under the title. */
  blurb: string
  direction: 'in' | 'out'
  register: Register
}

export const REGISTERS: RegisterSpec[] = [
  { kind: 'vendor-in',  title: 'Vendor IN',  blurb: 'What each vendor brought to site',
    direction: 'in',  register: 'vendor' },
  { kind: 'vendor-out', title: 'Vendor OUT', blurb: 'What went back to a vendor, against the delivery it answers',
    direction: 'out', register: 'vendor' },
  { kind: 'srm-in',     title: 'SRM IN',     blurb: 'Purchases taken into our own stock',
    direction: 'in',  register: 'srm' },
  { kind: 'srm-out',    title: 'SRM OUT',    blurb: 'Material issued to sites — with quantity, rate and amount',
    direction: 'out', register: 'srm' },
]

export const findRegister = (kind: string): RegisterSpec | undefined =>
  REGISTERS.find(r => r.kind === kind)

/** One line of a register — one item on one gate entry. */
export interface RegisterRow {
  entryId: string
  entryNo: string
  /** The entry this one answers, for a return. */
  linkedNo: string | null
  day: string
  party: string | null
  projectName: string | null
  entity: string | null
  place: string | null
  itemId: string
  itemName: string
  discipline: string | null
  unit: string
  qty: number
  rate: number | null
  /** qty × rate, or null when no rate is known — never silently zero. */
  amount: number | null
  poWoNo: string | null
  remarks: string | null
}

/** The map's filters: "Select Period · Select Vendor · Select Project ·
 *  Select Disciplines". Every one optional; absent means everything. */
export interface RegisterFilter {
  from?: string | null
  to?: string | null
  party?: string | null
  projectId?: string | null
  disciplineId?: string | null
}

export type GroupBy = 'project' | 'party' | 'discipline' | 'day'

export const GROUPS: Array<{ key: GroupBy; label: string }> = [
  { key: 'project',    label: 'Project' },
  { key: 'party',      label: 'Party' },
  { key: 'discipline', label: 'Discipline' },
  { key: 'day',        label: 'Day' },
]

export function groupValue(row: RegisterRow, by: GroupBy): string {
  if (by === 'project') return row.projectName ?? 'No project'
  if (by === 'party') return row.party ?? 'No party'
  if (by === 'discipline') return row.discipline ?? 'No discipline'
  return row.day
}

export interface RegisterTotals {
  entries: number
  lines: number
  /** Summed WITHIN a unit only. Adding bags to tonnes is the classic register
   *  lie, and one this report will not tell. */
  qtyByUnit: Record<string, number>
  amount: number
  /** True when some line has no rate, so `amount` understates the truth. */
  amountPartial: boolean
}

export function totals(rows: readonly RegisterRow[]): RegisterTotals {
  const t: RegisterTotals = { entries: 0, lines: rows.length, qtyByUnit: {}, amount: 0, amountPartial: false }
  const seen = new Set<string>()
  for (const r of rows) {
    seen.add(r.entryId)
    t.qtyByUnit[r.unit] = (t.qtyByUnit[r.unit] ?? 0) + r.qty
    if (r.amount == null) t.amountPartial = true
    else t.amount += r.amount
  }
  t.entries = seen.size
  return t
}

/** "Bags 40 · Nos 164" — the quantity total, honestly, unit by unit. */
export function qtyLine(t: RegisterTotals): string {
  return Object.entries(t.qtyByUnit)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([unit, qty]) => `${unit} ${fmtQty(qty)}`)
    .join(' · ')
}

export interface RegisterGroup {
  label: string
  rows: RegisterRow[]
  totals: RegisterTotals
}

/** Rows grouped and ordered for the screen and the export, which share this so
 *  a printed register and the screen it came from cannot disagree. */
export function groupRows(rows: readonly RegisterRow[], by: GroupBy): RegisterGroup[] {
  const by_ = new Map<string, RegisterRow[]>()
  for (const r of rows) {
    const k = groupValue(r, by)
    by_.set(k, [...(by_.get(k) ?? []), r])
  }
  return [...by_.entries()]
    // Day groups read newest first; every other grouping reads alphabetically.
    .sort((a, b) => (by === 'day' ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))
    .map(([label, rs]) => ({ label, rows: rs, totals: totals(rs) }))
}

/** The period as a person would say it, for the top of the page and the PDF. */
export function periodLabel(f: RegisterFilter): string {
  const d = (s: string) => {
    const [y, m, dd] = s.split('-')
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`
  }
  if (f.from && f.to) return `${d(f.from)} → ${d(f.to)}`
  if (f.from) return `From ${d(f.from)}`
  if (f.to) return `Up to ${d(f.to)}`
  return 'Everything on record'
}

/** The filters in force, spelled out under the period — so a printed page
 *  always says what it is a page OF. */
export function filterNotes(
  f: RegisterFilter,
  names: { project?: string | null; discipline?: string | null },
): string[] {
  const out: string[] = []
  if (f.party) out.push(`Party: ${f.party}`)
  if (names.project) out.push(`Project: ${names.project}`)
  if (names.discipline) out.push(`Discipline: ${names.discipline}`)
  return out
}
