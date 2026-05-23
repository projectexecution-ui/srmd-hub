// Server-side helpers for building the JMR matrix data structure.
// Rows = items grouped by category, columns = sub-projects, cells = {qty, amount}.

import { createClient } from '@/lib/supabase/server'

export type MatrixCell = { qty: number; amount: number }

export type MatrixRow = {
  item_id: string
  item_name: string
  category: 'equipment' | 'manpower'
  unit: string
  rate: number | null            // Most-recent rate for this contractor+item (display only)
  cells: Record<string, MatrixCell> // keyed by sub_project_id (or 'unassigned')
  total: MatrixCell
}

export type MatrixSubProject = { id: string; name: string; code: string | null }

export interface MatrixData {
  project: { id: string; name: string; code: string | null } | null
  contractor: { id: string; name: string } | null
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
  projectId: string | null
  contractorId: string | null
  subProjectIds: string[] | null   // null = all
  category: 'equipment' | 'manpower' | 'both'
  dateFrom: string | null          // null = cumulative
  dateTo: string                   // ISO date
  gstRatePct: number
}

export async function buildMatrix(filters: MatrixFilters): Promise<MatrixData> {
  const supabase = await createClient()

  const project = filters.projectId
    ? (await supabase.from('projects').select('id, name, code').eq('id', filters.projectId).single()).data
    : null

  const contractor = filters.contractorId
    ? (await supabase.from('jmr_contractors').select('id, name').eq('id', filters.contractorId).single()).data
    : null

  // Sub-projects of the selected project.
  let subProjects: MatrixSubProject[] = []
  if (filters.projectId) {
    const { data } = await supabase
      .from('projects')
      .select('id, name, code')
      .eq('parent_project_id', filters.projectId)
      .order('name')
    subProjects = data ?? []
    if (filters.subProjectIds && filters.subProjectIds.length > 0) {
      subProjects = subProjects.filter(s => filters.subProjectIds!.includes(s.id))
    }
  }

  // Query daily entries with joins.
  let q = supabase
    .from('jmr_daily_entries')
    .select(`
      sub_project_id, item_id, quantity, amount, rate_snapshot,
      jmr_items!inner ( id, name, category, unit )
    `)
    .lte('entry_date', filters.dateTo)
  if (filters.dateFrom) q = q.gte('entry_date', filters.dateFrom)
  if (filters.projectId) q = q.eq('project_id', filters.projectId)
  if (filters.contractorId) q = q.eq('contractor_id', filters.contractorId)
  if (filters.category !== 'both') {
    q = q.eq('jmr_items.category', filters.category)
  }
  const { data: entries, error } = await q
  if (error) throw error

  // Pivot.
  const rowMap = new Map<string, MatrixRow>()
  type EntryRow = {
    sub_project_id: string | null
    rate_snapshot: number | string
    quantity: number | string
    amount: number | string
    jmr_items?: { id: string; name: string; category: 'equipment' | 'manpower'; unit: 'hr' | 'day' | 'nos' | 'cu_m' } | { id: string; name: string; category: 'equipment' | 'manpower'; unit: 'hr' | 'day' | 'nos' | 'cu_m' }[] | null
  }
  for (const eRaw of (entries ?? [])) {
    const e = eRaw as EntryRow
    const item = Array.isArray(e.jmr_items) ? e.jmr_items[0] : e.jmr_items
    if (!item) continue
    const key = item.id
    if (!rowMap.has(key)) {
      rowMap.set(key, {
        item_id: item.id,
        item_name: item.name,
        category: item.category,
        unit: item.unit,
        rate: Number(e.rate_snapshot),
        cells: {},
        total: { qty: 0, amount: 0 },
      })
    }
    const row = rowMap.get(key)!
    const colKey = e.sub_project_id ?? 'unassigned'
    if (!row.cells[colKey]) row.cells[colKey] = { qty: 0, amount: 0 }
    const qty = Number(e.quantity)
    const amount = Number(e.amount)
    row.cells[colKey].qty += qty
    row.cells[colKey].amount += amount
    row.total.qty += qty
    row.total.amount += amount
    // Keep latest seen rate.
    row.rate = Number(e.rate_snapshot)
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category === 'equipment' ? -1 : 1
    return a.item_name.localeCompare(b.item_name)
  })

  // Column subtotals.
  const subTotalsBySubProject: Record<string, number> = {}
  for (const sp of subProjects) subTotalsBySubProject[sp.id] = 0
  subTotalsBySubProject['unassigned'] = 0
  for (const row of rows) {
    for (const [colKey, cell] of Object.entries(row.cells)) {
      subTotalsBySubProject[colKey] = (subTotalsBySubProject[colKey] ?? 0) + cell.amount
    }
  }
  const subTotalAll = Object.values(subTotalsBySubProject).reduce((s, n) => s + n, 0)
  const gstAmount = +(subTotalAll * (filters.gstRatePct / 100)).toFixed(2)
  const grandTotal = +(subTotalAll + gstAmount).toFixed(2)

  return {
    project: project ?? null,
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
