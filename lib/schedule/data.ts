// Schedule tracker — server-side data access + config loaders.
// Pure formula lives in ./formula (importable client-side too).

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { APP_TIME_ZONE } from '@/lib/utils'
import { DEFAULT_LEADS } from './formula'
import { DEFAULT_FLOORS, floorsSettingKey, parseFloors } from './floors'
import type { LeadDays, SchedItem, SchedProgress, SchedDrawing } from './types'

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
  item_count: number
}

/** Projects for the picker, with a schedule item count. */
export const getScheduleProjects = cache(async (): Promise<SchedProject[]> => {
  const sb = await createClient()
  const [{ data: projects }, { data: items }] = await Promise.all([
    sb.from('projects').select('id, code, name, status').order('code', { ascending: true }),
    sb.from('sched_items').select('project_id'),
  ])
  const counts = new Map<string, number>()
  for (const r of (items ?? []) as Array<{ project_id: string }>) {
    counts.set(r.project_id, (counts.get(r.project_id) ?? 0) + 1)
  }
  return ((projects ?? []) as Array<{ id: string; code: string | null; name: string; status: string | null }>)
    .map(p => ({ ...p, item_count: counts.get(p.id) ?? 0 }))
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
  const saved = parseFloors(data?.value as string | undefined)
  if (saved) return saved
  const fromSeed = (seeded ?? []).map(f => f.name.trim()).filter(Boolean)
  if (fromSeed.length) return Array.from(new Set(fromSeed))
  return DEFAULT_FLOORS
}

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

  const [{ data: items }, { data: floors }, { data: drawings }, leads, aiProjects] = await Promise.all([
    sb.from('sched_items').select('*').eq('project_id', projectId).order('seq', { ascending: true }),
    sb.from('project_floors').select('id, name, sequence').eq('project_id', projectId).order('sequence', { ascending: true }),
    sb.from('sched_drawings').select('*').eq('project_id', projectId),
    getLeadDays(),
    getAiAssistProjects(),
  ])

  const itemIds = ((items ?? []) as SchedItem[]).map(i => i.id)
  let progress: SchedProgress[] = []
  if (itemIds.length) {
    const { data: pr } = await sb.from('sched_progress').select('*').in('item_id', itemIds)
    progress = (pr ?? []) as SchedProgress[]
  }

  const floorRows = (floors ?? []) as Array<{ id: string; name: string; sequence: number }>
  const floorNames = await getScheduleFloors(projectId, floorRows)

  return {
    project: project as ProjectScheduleData['project'],
    items: (items ?? []) as SchedItem[],
    progress,
    drawings: (drawings ?? []) as SchedDrawing[],
    floors: floorRows,
    floorNames,
    leads,
    today: todayISO(),
    aiAssist: aiProjects.includes(projectId),
  }
}
