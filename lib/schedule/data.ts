// Schedule tracker — server-side data access + config loaders.
// Pure formula lives in ./formula (importable client-side too).

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { APP_TIME_ZONE } from '@/lib/utils'
import { DEFAULT_LEADS, addDays, daysBetween, workBackDeadlines } from './formula'
import { deriveSchedule } from './sequence'
import { DEFAULT_FLOORS, floorsSettingKey, parseFloors, sortFloors } from './floors'
import type { LeadDays, SchedItem, SchedProgress, SchedDrawing, SchedPromise } from './types'

/** Monday of the week containing the given IST date ("YYYY-MM-DD"). */
export function weekStartISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  const day = dt.getUTCDay() // 0 Sun .. 6 Sat
  const back = day === 0 ? 6 : day - 1
  return addDays(iso, -back)
}

/** Today as an IST calendar date ("YYYY-MM-DD"). */
export function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export interface SchedProject {
  id: string
  code: string | null
  name: string
  status: string | null
  parent_project_id: string | null
  item_count: number
  pct: number        // overall % done (active items) — the management snapshot
  attention: number  // items with a WO deadline already passed and no WO
}

/** Projects for the picker, with a schedule item count + progress + a red-flag
 *  count, so the picker doubles as a management portfolio landing. */
export const getScheduleProjects = cache(async (): Promise<SchedProject[]> => {
  const sb = await createClient()
  const [{ data: projects }, { data: items }, leads] = await Promise.all([
    sb.from('projects').select('id, code, name, status, parent_project_id').order('code', { ascending: true }),
    sb.from('sched_items').select('project_id, pct, state, plan_start, wo_issued'),
    getLeadDays(),
  ])
  const today = todayISO()
  type Agg = { count: number; sum: number; active: number; attention: number }
  const agg = new Map<string, Agg>()
  for (const r of (items ?? []) as Array<{ project_id: string; pct: number | null; state: string; plan_start: string | null; wo_issued: boolean }>) {
    const a = agg.get(r.project_id) ?? { count: 0, sum: 0, active: 0, attention: 0 }
    a.count += 1
    if (r.state !== 'on_hold') { a.active += 1; a.sum += r.pct ?? 0 }
    if (!r.wo_issued && r.plan_start && addDays(r.plan_start, -leads.procurement) < today) a.attention += 1
    agg.set(r.project_id, a)
  }
  return ((projects ?? []) as Array<{ id: string; code: string | null; name: string; status: string | null; parent_project_id: string | null }>)
    .map(p => {
      const a = agg.get(p.id)
      return {
        ...p,
        item_count: a?.count ?? 0,
        pct: a && a.active ? Math.round(a.sum / a.active) : 0,
        attention: a?.attention ?? 0,
      }
    })
})

export async function getLeadDays(): Promise<LeadDays> {
  const sb = await createClient()
  const { data } = await sb.from('app_settings').select('key, value')
    .in('key', ['sched_lead_procurement_days', 'sched_lead_approval_days', 'sched_lead_drawing_days'])
  const m = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, Number(r.value)]))
  const num = (k: string, d: number) => {
    const v = m.get(k); return v != null && !Number.isNaN(v) ? v : d
  }
  return {
    procurement: num('sched_lead_procurement_days', DEFAULT_LEADS.procurement),
    approval: num('sched_lead_approval_days', DEFAULT_LEADS.approval),
    drawing: num('sched_lead_drawing_days', DEFAULT_LEADS.drawing),
  }
}

export async function getAiAssistProjects(): Promise<string[]> {
  const sb = await createClient()
  const { data } = await sb.from('app_settings').select('value').eq('key', 'sched_ai_assist_projects').maybeSingle()
  try {
    const arr = JSON.parse((data?.value as string) ?? '[]')
    return Array.isArray(arr) ? arr.map(String) : []
  } catch { return [] }
}

/** The floor/location columns for the progress matrix. Prefers the per-project
 *  saved list, then seeded project_floors, then the standard tower default. */
export async function getScheduleFloors(
  projectId: string,
  seeded?: Array<{ name: string }>,
): Promise<string[]> {
  const sb = await createClient()
  const { data } = await sb.from('app_settings').select('value')
    .eq('key', floorsSettingKey(projectId)).maybeSingle()
  const saved = parseFloors(data?.value as string | undefined)   // already sorted
  if (saved) return saved
  const fromSeed = (seeded ?? []).map(f => f.name.trim()).filter(Boolean)
  if (fromSeed.length) return sortFloors(Array.from(new Set(fromSeed)))
  return DEFAULT_FLOORS
}

export interface PortfolioWoRow {
  projectId: string
  projectCode: string
  itemName: string
  trade: string
  contractor: string | null
  woBy: string          // planned "raise by" date (derived work-back)
  daysLate: number      // >0 = overdue by N days
}
export interface PortfolioWoIssued {
  projectId: string; projectCode: string; itemName: string
  woNumber: string | null; issuedOn: string
}
export interface PortfolioWo {
  due: PortfolioWoRow[]           // not issued, due within 14d or overdue — most urgent first
  issuedRecent: PortfolioWoIssued[]  // issued in the last 14 days
}

/** Cross-project WO watch for the Schedule home page: every pending Work
 *  Order due soon/overdue (using each project's derived dates), plus the
 *  recently issued ones. */
export async function getPortfolioWo(): Promise<PortfolioWo> {
  const sb = await createClient()
  const today = todayISO()
  const [{ data: projects }, { data: items }, { data: prog }, { data: floorRows }, leads] = await Promise.all([
    sb.from('projects').select('id, code, name'),
    sb.from('sched_items').select('*'),
    sb.from('sched_progress').select('item_id, location, status'),
    sb.from('app_settings').select('key, value').like('key', 'sched_floors_%'),
    getLeadDays(),
  ])
  const codeOf = new Map(((projects ?? []) as Array<{ id: string; code: string | null; name: string }>)
    .map(p => [p.id, p.code || p.name]))
  const floorsOf = new Map(((floorRows ?? []) as Array<{ key: string; value: string }>)
    .map(r => [r.key.replace('sched_floors_', ''), parseFloors(r.value) ?? DEFAULT_FLOORS]))
  const cellMap = new Map<string, FloorStatusLite>()
  for (const p of (prog ?? []) as Array<{ item_id: string; location: string; status: FloorStatusLite }>) {
    cellMap.set(`${p.item_id}|${p.location.trim().toLowerCase()}`, p.status)
  }
  const byProject = new Map<string, SchedItem[]>()
  for (const it of (items ?? []) as SchedItem[]) {
    if (!byProject.has(it.project_id)) byProject.set(it.project_id, [])
    byProject.get(it.project_id)!.push(it)
  }

  const due: PortfolioWoRow[] = []
  const issuedRecent: PortfolioWoIssued[] = []
  const cutoffIssued = addDays(today, -14)
  for (const [pid, list] of byProject) {
    const floors = floorsOf.get(pid) ?? DEFAULT_FLOORS
    const cellOf = (id: string, f: string) => cellMap.get(`${id}|${f.trim().toLowerCase()}`) ?? 'not_started'
    const derived = deriveSchedule(list, floors, cellOf)
    for (const it of list) {
      if (it.state === 'on_hold') continue
      if (it.wo_issued) {
        if (it.wo_issued_on && it.wo_issued_on >= cutoffIssued) {
          issuedRecent.push({ projectId: pid, projectCode: codeOf.get(pid) ?? '?', itemName: it.name, woNumber: it.wo_number, issuedOn: it.wo_issued_on })
        }
        continue
      }
      if (it.pct >= 100 || it.state === 'done') continue
      const start = derived.get(it.id)?.start ?? it.plan_start
      const woBy = workBackDeadlines(start, leads).woBy
      if (!woBy) continue
      const late = daysBetween(woBy, today)   // >0 = overdue
      if (late >= -14) due.push({ projectId: pid, projectCode: codeOf.get(pid) ?? '?', itemName: it.name, trade: it.trade, contractor: it.contractor, woBy, daysLate: late })
    }
  }
  due.sort((a, b) => b.daysLate - a.daysLate)
  issuedRecent.sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))
  return { due, issuedRecent }
}
type FloorStatusLite = 'not_started' | 'wip' | 'done' | 'na'

export interface ProjectScheduleData {
  project: {
    id: string; code: string | null; name: string; status: string | null
    start_date: string | null; target_completion: string | null
  }
  items: SchedItem[]
  progress: SchedProgress[]
  drawings: SchedDrawing[]
  floors: Array<{ id: string; name: string; sequence: number }>
  floorNames: string[]
  people: string[]     // active team names — for engineer/approver dropdowns
  vendors: string[]    // vendor/contractor names — for the contractor dropdown
  promises: SchedPromise[]              // this week's promise list
  lastWeek: { kept: number; total: number } | null  // last week's PPC inputs
  weekStart: string                     // Monday of the current IST week
  leads: LeadDays
  today: string
  aiAssist: boolean
}

export async function getProjectSchedule(projectId: string): Promise<ProjectScheduleData | null> {
  const sb = await createClient()
  const { data: project } = await sb.from('projects')
    .select('id, code, name, status, start_date, target_completion')
    .eq('id', projectId).maybeSingle()
  if (!project) return null

  const [{ data: items }, { data: floors }, { data: drawings }, { data: profiles }, { data: vendorRows }, leads, aiProjects] = await Promise.all([
    sb.from('sched_items').select('*').eq('project_id', projectId).order('seq', { ascending: true }),
    sb.from('project_floors').select('id, name, sequence').eq('project_id', projectId).order('sequence', { ascending: true }),
    sb.from('sched_drawings').select('*').eq('project_id', projectId),
    sb.from('profiles').select('full_name, name, email, is_active'),
    sb.from('vendors').select('name').order('name', { ascending: true }),
    getLeadDays(),
    getAiAssistProjects(),
  ])

  const people = Array.from(new Set(
    ((profiles ?? []) as Array<{ full_name: string | null; name: string | null; email: string | null; is_active: boolean | null }>)
      .filter(p => p.is_active !== false)
      .map(p => (p.full_name || p.name || p.email || '').trim())
      .filter(Boolean),
  )).sort((a, b) => a.localeCompare(b))
  const vendors = Array.from(new Set(
    ((vendorRows ?? []) as Array<{ name: string | null }>).map(v => (v.name || '').trim()).filter(Boolean),
  ))

  const itemIds = ((items ?? []) as SchedItem[]).map(i => i.id)
  let progress: SchedProgress[] = []
  if (itemIds.length) {
    const { data: pr } = await sb.from('sched_progress').select('*').in('item_id', itemIds)
    progress = (pr ?? []) as SchedProgress[]
  }

  const floorRows = (floors ?? []) as Array<{ id: string; name: string; sequence: number }>
  const floorNames = await getScheduleFloors(projectId, floorRows)

  const today = todayISO()
  const monday = weekStartISO(today)
  const prevMonday = addDays(monday, -7)
  const [{ data: promiseRows }, { data: lastRows }] = await Promise.all([
    sb.from('sched_promises').select('*').eq('project_id', projectId).eq('week_start', monday).order('created_at', { ascending: true }),
    sb.from('sched_promises').select('status').eq('project_id', projectId).eq('week_start', prevMonday),
  ])
  const last = (lastRows ?? []) as Array<{ status: string }>
  const lastWeek = last.length
    ? { kept: last.filter(r => r.status === 'done').length, total: last.length }
    : null

  return {
    project: project as ProjectScheduleData['project'],
    items: (items ?? []) as SchedItem[],
    progress,
    drawings: (drawings ?? []) as SchedDrawing[],
    floors: floorRows,
    floorNames,
    people,
    vendors,
    promises: (promiseRows ?? []) as SchedPromise[],
    lastWeek,
    weekStart: monday,
    leads,
    today,
    aiAssist: aiProjects.includes(projectId),
  }
}
