// SC Budgets — the top-management report.
//
// Aksha, 2026-09-03: "give me flexibilty to Mix Category and Sub Cateegory of
// the Respective Projects and also give me Flexibilty to Change the Amt of the
// Columns also give FLexibilty of Selecting the Columns to be attached for the
// report."
//
// So three separate freedoms, and they are genuinely separate:
//   1. WHICH ROWS   — any mix of categories and sub-categories, across any
//                     mix of projects. Not one project at a time.
//   2. WHICH AMOUNT — each column shows a chosen measure (Internal Estimate,
//                     ERP Budget, WO/PO, Paid, Balance, ₹/sft, % Used).
//   3. WHICH COLUMNS go into the exported PDF, which need not be all of the
//                     columns on screen.
//
// Pure — no Supabase, no React — so the arithmetic and the totals are tested
// rather than eyeballed on a report that goes to the Trustee.
//
// CONFIDENTIAL. Gated on `budget-vs-actual-v2`, held today by admin and head
// only. That excludes coordinator (Parimal) and backoffice (Mayank) by
// construction — both named by Aksha as people who must not see it.

/** A money measure a column can show. */
export type MeasureId =
  | 'ie' | 'budget' | 'wo' | 'paid' | 'balance' | 'outstanding' | 'used_pct' | 'per_sft'

export interface Measure {
  id: MeasureId
  /** ≤5 words. */
  label: string
  hint: string
  /** How it renders: money in the chosen unit, a percentage, or a rate. */
  kind: 'money' | 'pct' | 'rate'
  /** Management-confidential even within this report — the Internal Estimate
   *  is management's own baseline and is never shown to anyone else. */
  confidential?: boolean
}

export const MEASURES: readonly Measure[] = [
  { id: 'ie',          label: 'Internal Estimate', hint: "Management's own baseline", kind: 'money', confidential: true },
  { id: 'budget',      label: 'Budget (ERP)',      hint: 'Released by IN4',           kind: 'money' },
  { id: 'wo',          label: 'WO / PO',           hint: 'Committed to contractors',  kind: 'money' },
  { id: 'paid',        label: 'Paid',              hint: 'Actually paid out',         kind: 'money' },
  { id: 'balance',     label: 'Balance',           hint: 'Budget less paid',          kind: 'money' },
  { id: 'outstanding', label: 'Uncommitted',       hint: 'Budget with no WO raised',  kind: 'money' },
  { id: 'used_pct',    label: '% Used',            hint: 'Paid against budget',       kind: 'pct' },
  { id: 'per_sft',     label: 'Budget / sft',      hint: 'Budget over built-up area', kind: 'rate' },
] as const

/** What a report opens with — the four figures the HOD reads first. */
export const DEFAULT_COLUMNS: MeasureId[] = ['budget', 'wo', 'paid', 'balance']

export function measure(id: MeasureId): Measure {
  const m = MEASURES.find(x => x.id === id)
  if (!m) throw new Error(`Unknown measure "${id}"`)
  return m
}

/** ₹ as-is, or scaled — a portfolio report in rupees is unreadable. */
export type Unit = 'rupee' | 'lakh' | 'crore'

export const UNITS: ReadonlyArray<{ id: Unit; label: string; suffix: string; divisor: number; dp: number }> = [
  { id: 'rupee', label: 'Rupees', suffix: '',    divisor: 1,    dp: 0 },
  { id: 'lakh',  label: 'Lakh',   suffix: ' L',  divisor: 1e5,  dp: 2 },
  { id: 'crore', label: 'Crore',  suffix: ' Cr', divisor: 1e7,  dp: 2 },
] as const

/** One line of source data — a sub-category of a category of a project. */
export interface SourceLine {
  projectId: string
  projectName: string
  disciplineCode: string
  disciplineName: string
  /** Null for a line that sits at category level with no sub-category. */
  subCode: string | null
  subName: string | null
  ie: number
  budget: number
  wo: number
  paid: number
  /** Built-up area of the project, for ₹/sft. 0 when not set. */
  sft: number
}

/** How the report is grouped. */
export type Grouping = 'category' | 'subcategory' | 'project'

/**
 * A CLUB — Aksha, 2026-09-03: "i want to club 2 Sub cat in one name and also
 * sometine 2 CAt in one name".
 *
 * Categories and sub-categories can be mixed inside one club, because the
 * reason for clubbing is presentational: the HOD wants "Finishes" as one line,
 * and what makes that up may be two categories on one project and three
 * sub-categories on another.
 */
export interface Bucket {
  id: string
  /** What the clubbed line is called on the report. */
  name: string
  disciplineCodes: string[]
  subCodes: string[]
}

export interface Selection {
  projectIds: string[]
  /** Empty = every category. */
  disciplineCodes: string[]
  /** Empty = every sub-category within the chosen categories. */
  subCodes: string[]
  grouping: Grouping
  columns: MeasureId[]
  unit: Unit
  /** Columns ticked for the PDF. Empty = whatever is on screen. */
  pdfColumns: MeasureId[]
  /** Clubbed lines. Anything not claimed by one is grouped normally. */
  buckets: Bucket[]
}

export function defaultSelection(projectIds: string[]): Selection {
  return {
    projectIds,
    disciplineCodes: [],
    subCodes: [],
    grouping: 'category',
    columns: [...DEFAULT_COLUMNS],
    unit: 'lakh',
    pdfColumns: [],
    buckets: [],
  }
}

/**
 * Which club claims a line, if any.
 *
 * A SUB-category match wins over a category match, even if the category club
 * comes first — the more specific rule is what someone means when they club a
 * single sub-category out of a category they have also clubbed. Among equally
 * specific matches, the first club wins, so the result is deterministic and a
 * line can never be counted twice.
 */
export function bucketFor(line: SourceLine, buckets: Bucket[]): Bucket | null {
  if (line.subCode) {
    const bySub = buckets.find(b => b.subCodes.includes(line.subCode!))
    if (bySub) return bySub
  }
  return buckets.find(b => b.disciplineCodes.includes(line.disciplineCode)) ?? null
}

/** A club with no members contributes nothing and would print an empty row. */
export function usableBuckets(buckets: Bucket[]): Bucket[] {
  return buckets.filter(b =>
    b.name.trim().length > 0 && (b.disciplineCodes.length + b.subCodes.length) > 0)
}

/** Rows that survive the project / category / sub-category picks. */
export function filterLines(lines: SourceLine[], s: Selection): SourceLine[] {
  const projects = new Set(s.projectIds)
  const discs = new Set(s.disciplineCodes)
  const subs = new Set(s.subCodes)
  return lines.filter(l => {
    if (projects.size > 0 && !projects.has(l.projectId)) return false
    if (discs.size > 0 && !discs.has(l.disciplineCode)) return false
    // A sub-category pick only narrows lines that HAVE a sub-category, so a
    // category-level line is not silently dropped by a sub pick.
    if (subs.size > 0 && l.subCode != null && !subs.has(l.subCode)) return false
    return true
  })
}

export interface ReportRow {
  key: string
  label: string
  /** Shown small under the label — which project(s) the row covers. */
  sub: string
  values: Record<MeasureId, number>
  /** How many source lines rolled into this row. */
  lines: number
  /** True when this row is a club, so the report can mark it as one. */
  isClub?: boolean
}

const zero = (): Record<MeasureId, number> => ({
  ie: 0, budget: 0, wo: 0, paid: 0, balance: 0, outstanding: 0, used_pct: 0, per_sft: 0,
})

/** Derived measures are computed AFTER summing, never summed themselves —
 *  adding percentages or rates together is meaningless. */
function derive(v: Record<MeasureId, number>, sft: number): void {
  v.balance = v.budget - v.paid
  v.outstanding = v.budget - v.wo
  v.used_pct = v.budget > 0 ? (v.paid / v.budget) * 100 : 0
  v.per_sft = sft > 0 ? v.budget / sft : 0
}

export function buildRows(lines: SourceLine[], s: Selection): ReportRow[] {
  const groups = new Map<string, { label: string; projects: Set<string>; sft: Map<string, number>; v: Record<MeasureId, number>; n: number }>()

  const clubs = usableBuckets(s.buckets)

  for (const l of lines) {
    // A club overrides the grouping — that is the whole point of clubbing.
    const club = clubs.length > 0 ? bucketFor(l, clubs) : null

    const key = club
      ? `club:${club.id}`
      : s.grouping === 'project'    ? l.projectId
      : s.grouping === 'category'   ? `${l.disciplineCode}`
      : `${l.disciplineCode}|${l.subCode ?? '—'}`
    const label = club
      ? club.name
      : s.grouping === 'project'    ? l.projectName
      : s.grouping === 'category'   ? `${l.disciplineCode} ${l.disciplineName}`
      : `${l.subCode ?? l.disciplineCode} ${l.subName ?? l.disciplineName}`

    let g = groups.get(key)
    if (!g) {
      g = { label, projects: new Set(), sft: new Map(), v: zero(), n: 0 }
      groups.set(key, g)
    }
    g.projects.add(l.projectName)
    // One area per project, not per line — summing sft per line would multiply
    // the area by the number of categories and make ₹/sft nonsense.
    g.sft.set(l.projectId, l.sft)
    g.v.ie += l.ie
    g.v.budget += l.budget
    g.v.wo += l.wo
    g.v.paid += l.paid
    g.n += 1
  }

  const rows: ReportRow[] = [...groups.entries()].map(([key, g]) => {
    const sft = [...g.sft.values()].reduce((a, b) => a + b, 0)
    derive(g.v, sft)
    const names = [...g.projects].sort()
    return {
      key,
      label: g.label,
      sub: names.length === 1 ? names[0] : `${names.length} projects`,
      values: g.v,
      lines: g.n,
      isClub: key.startsWith('club:'),
    }
  })

  // Clubs first, in the order they were defined — someone who clubbed lines
  // did so to control how the report reads, so their order is the intent.
  // Everything else follows: categories by code number (the one ordering rule
  // used across the app), projects biggest-budget first.
  const clubOrder = new Map(clubs.map((b, i) => [`club:${b.id}`, i]))
  return rows.sort((a, b) => {
    const ca = clubOrder.get(a.key), cb = clubOrder.get(b.key)
    if (ca != null && cb != null) return ca - cb
    if (ca != null) return -1
    if (cb != null) return 1
    return s.grouping === 'project'
      ? b.values.budget - a.values.budget
      : a.label.localeCompare(b.label, undefined, { numeric: true })
  })
}

/** The Total line. Derived measures are recomputed, never added up. */
export function totalRow(rows: ReportRow[], lines: SourceLine[]): ReportRow {
  const v = zero()
  for (const r of rows) {
    v.ie += r.values.ie
    v.budget += r.values.budget
    v.wo += r.values.wo
    v.paid += r.values.paid
  }
  // Area once per project across the whole report.
  const sftByProject = new Map<string, number>()
  for (const l of lines) sftByProject.set(l.projectId, l.sft)
  derive(v, [...sftByProject.values()].reduce((a, b) => a + b, 0))
  return {
    key: '__total',
    label: 'Total',
    sub: `${sftByProject.size} project${sftByProject.size === 1 ? '' : 's'}`,
    values: v,
    lines: rows.reduce((n, r) => n + r.lines, 0),
  }
}

/** Format one cell. Indian grouping throughout; a rate is never scaled. */
export function formatCell(value: number, id: MeasureId, unit: Unit): string {
  const m = measure(id)
  if (m.kind === 'pct') return value > 0 ? `${value.toFixed(0)}%` : '—'
  if (m.kind === 'rate') return value > 0 ? `₹${Math.round(value).toLocaleString('en-IN')}` : '—'
  if (!value) return '—'
  const u = UNITS.find(x => x.id === unit)!
  const n = value / u.divisor
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: u.dp, maximumFractionDigits: u.dp })}${u.suffix}`
}

/** Which columns the PDF carries — the on-screen set unless narrowed. */
export function pdfColumnsOf(s: Selection): MeasureId[] {
  if (s.pdfColumns.length === 0) return s.columns
  // Never let the PDF carry a column that is not part of the report.
  return s.columns.filter(c => s.pdfColumns.includes(c))
}

/**
 * SAVED PER PROJECT — Aksha: "once i do this and want to save for per project".
 *
 * Stored in app_settings under one key per project, the same shape
 * `sched_floors_<id>` already uses. No new table, because the database is
 * shared with the live app and adding one is not a branch-only change.
 *
 * Only the presentational choices are saved. `projectIds` is NOT, because the
 * report always opens on the project you are standing in — saving it would
 * make a report open somewhere other than where you clicked.
 */
export const savedKeyFor = (projectId: string) => `sc_budgets_${projectId}`

export interface SavedLayout {
  buckets: Bucket[]
  columns: MeasureId[]
  unit: Unit
  grouping: Grouping
  pdfColumns: MeasureId[]
}

export function toSaved(s: Selection): SavedLayout {
  return {
    buckets: usableBuckets(s.buckets),
    columns: s.columns,
    unit: s.unit,
    grouping: s.grouping,
    pdfColumns: s.pdfColumns,
  }
}

/**
 * Rebuild a selection from what was saved.
 *
 * Every field is checked rather than trusted: this JSON is edited by hand in
 * app_settings from time to time, and a bad value must degrade to the default
 * rather than throw on a report the Trustee is opening.
 */
export function fromSaved(raw: unknown, projectIds: string[]): Selection {
  const base = defaultSelection(projectIds)
  if (!raw || typeof raw !== 'object') return base
  const v = raw as Partial<SavedLayout>
  const validIds = new Set(MEASURES.map(m => m.id))
  const cols = Array.isArray(v.columns) ? v.columns.filter(c => validIds.has(c)) : []
  const pdf = Array.isArray(v.pdfColumns) ? v.pdfColumns.filter(c => validIds.has(c)) : []
  const grouping: Grouping =
    v.grouping === 'category' || v.grouping === 'subcategory' || v.grouping === 'project'
      ? v.grouping : base.grouping
  const unit: Unit = UNITS.some(u => u.id === v.unit) ? (v.unit as Unit) : base.unit
  const buckets = Array.isArray(v.buckets)
    ? v.buckets
        .filter((b): b is Bucket => !!b && typeof b === 'object' && typeof (b as Bucket).name === 'string')
        .map((b, i) => ({
          id: typeof b.id === 'string' && b.id ? b.id : `club-${i}`,
          name: b.name,
          disciplineCodes: Array.isArray(b.disciplineCodes) ? b.disciplineCodes.map(String) : [],
          subCodes: Array.isArray(b.subCodes) ? b.subCodes.map(String) : [],
        }))
    : []
  return {
    ...base,
    grouping,
    unit,
    // An empty saved column list would render a table with no figures.
    columns: cols.length > 0 ? cols : base.columns,
    pdfColumns: pdf,
    buckets: usableBuckets(buckets),
  }
}

/** A one-line description of what the report covers, for the PDF header. */
export function describeSelection(s: Selection, projectNames: Map<string, string>): string {
  const projects = s.projectIds.length === 0
    ? 'All projects'
    : s.projectIds.length <= 3
      ? s.projectIds.map(id => projectNames.get(id) ?? id).join(', ')
      : `${s.projectIds.length} projects`
  const scope =
    s.disciplineCodes.length === 0 ? 'all categories'
    : `${s.disciplineCodes.length} categor${s.disciplineCodes.length === 1 ? 'y' : 'ies'}`
  const subs = s.subCodes.length > 0 ? `, ${s.subCodes.length} sub-categories` : ''
  const by = s.grouping === 'subcategory' ? 'sub-category' : s.grouping
  return `${projects} · ${scope}${subs} · by ${by} · ${UNITS.find(u => u.id === s.unit)!.label}`
}
