// Server-side helpers for building the JMR matrix data structure.
// Rows = items grouped by category, columns = sub-projects, cells = {qty, amount}.

import { createClient } from '@/lib/supabase/server'

export type MatrixCell = { qty: number; amount: number }

export type MatrixRow = {
  item_id: string
  item_name: string
  category: 'equipment' | 'manpower'
  unit: string
  rate: number | null            // Rate for THIS row's rate band (same item at
                                 // different rates appears as separate rows).
  cells: Record<string, MatrixCell> // keyed by sub_project_id (or parent project_id)
  total: MatrixCell
  /** Earliest entry_date seen for this (item, rate) bucket. ISO yyyy-mm-dd. */
  effectiveFrom: string | null
  /** Latest entry_date seen for this (item, rate) bucket. */
  effectiveTo: string | null
}

export type MatrixSubProject = { id: string; name: string; code: string | null }

export interface MatrixData {
  /** All selected top-level projects (was single `project`). The page title
   *  picks a sensible label from this list. */
  projects: { id: string; name: string; code: string | null }[]
  contractor: { id: string; name: string } | null
  /** Renamed conceptually to "columns" — each column is either a sub-project
   *  or one of the selected parent projects (when entries landed directly on
   *  the parent rather than on a sub-project). Field name kept for backward
   *  compatibility with matrix-table.tsx. */
  subProjects: MatrixSubProject[]
  rows: MatrixRow[]
  subTotalsBySubProject: Record<string, number>
  subTotalAll: number
  gstRate: number
  gstAmount: number
  grandTotal: number
  dateFrom: string | null
  dateTo: string
}

export interface MatrixFilters {
  /** Top-level project IDs. Empty / null = no project selected (caller
   *  should render an empty state). One ID = single-project view (legacy).
   *  Multiple IDs = combined matrix spanning all of them. */
  projectIds: string[]
  contractorId: string | null
  subProjectIds: string[] | null   // null = all
  category: 'equipment' | 'manpower' | 'both'
  dateFrom: string | null          // null = cumulative
  dateTo: string                   // ISO date
  gstRatePct: number
}

export async function buildMatrix(filters: MatrixFilters): Promise<MatrixData> {
  const supabase = await createClient()

  const projectIds = filters.projectIds ?? []
  const projects = projectIds.length > 0
    ? ((await supabase
        .from('projects')
        .select('id, name, code')
        .in('id', projectIds)
        .order('name')
      ).data ?? [])
    : []

  const contractor = filters.contractorId
    ? (await supabase.from('jmr_contractors').select('id, name').eq('id', filters.contractorId).single()).data
    : null

  // Columns are sub-projects of the selected parents PLUS each parent itself
  // (so entries with no sub_project_id land in the parent's column instead of
  // a generic 'Unassigned' bucket). Empty columns are filtered out at the end.
  let subProjectsRaw: MatrixSubProject[] = []
  if (projectIds.length > 0) {
    const { data } = await supabase
      .from('projects')
      .select('id, name, code')
      .in('parent_project_id', projectIds)
      .order('name')
    subProjectsRaw = data ?? []
    if (filters.subProjectIds && filters.subProjectIds.length > 0) {
      subProjectsRaw = subProjectsRaw.filter(s => filters.subProjectIds!.includes(s.id))
    }
  }
  // Parent projects are also columns (for entries directly on the parent).
  const parentColumns: MatrixSubProject[] = projects.map(p => ({ id: p.id, name: p.name, code: p.code }))
  const allColumns: MatrixSubProject[] = [...parentColumns, ...subProjectsRaw]

  // Query daily entries with joins.
  let q = supabase
    .from('jmr_daily_entries')
    .select(`
      project_id, sub_project_id, item_id, quantity, amount, rate_snapshot, entry_date,
      jmr_items!inner ( id, name, category, unit )
    `)
    .lte('entry_date', filters.dateTo)
  if (filters.dateFrom) q = q.gte('entry_date', filters.dateFrom)
  if (projectIds.length > 0) q = q.in('project_id', projectIds)
  if (filters.contractorId) q = q.eq('contractor_id', filters.contractorId)
  if (filters.category !== 'both') {
    q = q.eq('jmr_items.category', filters.category)
  }
  const { data: entries, error } = await q
  if (error) throw error

  // Pivot. colKey = sub_project_id ?? project_id, so parent-direct entries
  // land in their parent's column.
  //
  // ROW KEY = (item_id, rate_snapshot). Same item at two different rates
  // (rate escalation / devaluation inside the period) becomes two rows —
  // this is the A + B split the report needs. Subtotals sum across all
  // rows so the grand total is unchanged.
  const rowMap = new Map<string, MatrixRow>()
  type EntryRow = {
    project_id: string
    sub_project_id: string | null
    rate_snapshot: number | string
    quantity: number | string
    amount: number | string
    entry_date: string
    jmr_items?: { id: string; name: string; category: 'equipment' | 'manpower'; unit: 'hr' | 'day' | 'nos' | 'cu_m' } | { id: string; name: string; category: 'equipment' | 'manpower'; unit: 'hr' | 'day' | 'nos' | 'cu_m' }[] | null
  }
  for (const eRaw of (entries ?? [])) {
    const e = eRaw as EntryRow
    const item = Array.isArray(e.jmr_items) ? e.jmr_items[0] : e.jmr_items
    if (!item) continue
    const rate = Number(e.rate_snapshot)
    const key = `${item.id}::${rate}`
    if (!rowMap.has(key)) {
      rowMap.set(key, {
        item_id: item.id,
        item_name: item.name,
        category: item.category,
        unit: item.unit,
        rate,
        cells: {},
        total: { qty: 0, amount: 0 },
        effectiveFrom: e.entry_date,
        effectiveTo: e.entry_date,
      })
    }
    const row = rowMap.get(key)!
    const colKey = e.sub_project_id ?? e.project_id
    if (!row.cells[colKey]) row.cells[colKey] = { qty: 0, amount: 0 }
    const qty = Number(e.quantity)
    const amount = Number(e.amount)
    row.cells[colKey].qty += qty
    row.cells[colKey].amount += amount
    row.total.qty += qty
    row.total.amount += amount
    // Widen the period window if this entry sits outside it.
    if (row.effectiveFrom == null || e.entry_date < row.effectiveFrom) row.effectiveFrom = e.entry_date
    if (row.effectiveTo   == null || e.entry_date > row.effectiveTo)   row.effectiveTo = e.entry_date
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category === 'equipment' ? -1 : 1
    const byName = a.item_name.localeCompare(b.item_name)
    if (byName !== 0) return byName
    // Same item, different rates → lower rate first (treat as Period A,
    // the typical "before escalation" band).
    return (a.rate ?? 0) - (b.rate ?? 0)
  })

  // Drop columns that have zero activity (cleaner table — esp. for parents
  // when all their entries are under sub-projects).
  const activeColKeys = new Set<string>()
  for (const row of rows) {
    for (const k of Object.keys(row.cells)) activeColKeys.add(k)
  }
  // Preserve order: parent columns first (in projects order), then sub-projects.
  const subProjects = allColumns.filter(c => activeColKeys.has(c.id))

  // Column subtotals.
  const subTotalsBySubProject: Record<string, number> = {}
  for (const sp of subProjects) subTotalsBySubProject[sp.id] = 0
  for (const row of rows) {
    for (const [colKey, cell] of Object.entries(row.cells)) {
      subTotalsBySubProject[colKey] = (subTotalsBySubProject[colKey] ?? 0) + cell.amount
    }
  }
  const subTotalAll = Object.values(subTotalsBySubProject).reduce((s, n) => s + n, 0)
  const gstAmount = +(subTotalAll * (filters.gstRatePct / 100)).toFixed(2)
  const grandTotal = +(subTotalAll + gstAmount).toFixed(2)

  return {
    projects,
    contractor: contractor ?? null,
    subProjects,
    rows,
    subTotalsBySubProject,
    subTotalAll,
    gstRate: filters.gstRatePct,
    gstAmount,
    grandTotal,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
  }
}

export const COLUMN_PALETTE = [
  { bg: 'bg-blue-100',   text: 'text-blue-900',   header: '#dbeafe', headerText: '#1e3a8a' },
  { bg: 'bg-pink-100',   text: 'text-pink-900',   header: '#fce7f3', headerText: '#831843' },
  { bg: 'bg-emerald-100',text: 'text-emerald-900',header: '#d1fae5', headerText: '#064e3b' },
  { bg: 'bg-purple-100', text: 'text-purple-900', header: '#ede9fe', headerText: '#4c1d95' },
  { bg: 'bg-amber-100',  text: 'text-amber-900',  header: '#fef3c7', headerText: '#78350f' },
]
