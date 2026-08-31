// Bills sitting with CT, for ONE project.
//
// Reads the SAME snapshot the Bills Pipeline module renders
// (app_settings.bills_pipeline_cockpit), so the cockpit tab can hand it to that
// module's OWN <Cockpit> component rather than growing a second bills screen.
// Everything it does — stage ordering, ageing colours, stalled detection, the
// "Push today" list, the filters — comes along for free and stays in step.

import { createClient } from '@/lib/supabase/server'
import { matchSubProjects, clean, type HubProject } from './subproject-match'
import { PROJECT_ALIASES } from './alias-seed'
import { descendantIds } from './hierarchy'
import type { CockpitBill } from '@/lib/bills-pipeline/transform'

export interface ProjectBills {
  bills: CockpitBill[]
  /** The date the snapshot represents — everything here is only this fresh. */
  asOf: string
  /** When the pipeline last actually ran against Zoho. */
  generatedAt: string | null
  /** Whole days since that run, so a stale snapshot can say so itself. */
  ageDays: number | null
  /** Bills whose area matches no project in CT Hub at all. */
  unattributed: { count: number; claimed: number }
}

export async function loadProjectBills(projectId: string): Promise<ProjectBills> {
  const supabase = await createClient()
  const [{ data: rows }, { data: projRows }] = await Promise.all([
    supabase.from('app_settings').select('key, value')
      .in('key', ['bills_pipeline_cockpit', 'bills_pipeline_last']),
    supabase.from('projects').select('id, code, name, parent_project_id').is('archived_at', null),
  ])

  const byKey = new Map(((rows ?? []) as Array<{ key: string; value: string }>).map(r => [r.key, r.value]))

  let all: CockpitBill[] = []
  try {
    const parsed = JSON.parse(byKey.get('bills_pipeline_cockpit') ?? '[]')
    if (Array.isArray(parsed)) all = parsed as CockpitBill[]
  } catch { /* a malformed snapshot must not take the tab down */ }

  let asOf = 'latest'
  let generatedAt: string | null = null
  try {
    const meta = JSON.parse(byKey.get('bills_pipeline_last') ?? '{}')
    if (typeof meta?.asOf === 'string') asOf = meta.asOf
    if (typeof meta?.generatedAt === 'string') generatedAt = meta.generatedAt
  } catch { /* keep the defaults */ }

  const ageDays = generatedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(generatedAt).getTime()) / 86_400_000))
    : null

  const raw = (projRows ?? []) as Array<Record<string, unknown>>
  const projects = raw as unknown as HubProject[]
  const covered = new Set(descendantIds(
    raw.map(p => ({ id: p.id as string, parentId: (p.parent_project_id as string | null) ?? null })),
    projectId,
  ))

  // Attribute on `area` — the building — NOT on the snapshot's `project` code.
  // That code is "NGH" for every New Guest House bill, and the hub has a
  // project whose CODE is also "NGH" (NGH Infra), so matching on it would file
  // all of them against Infra. A group still picks its children up through
  // `covered`.
  const areas = [...new Set(all.map(b => clean(String(b.area ?? ''))).filter(Boolean))]
  const areaToProject = new Map(
    matchSubProjects(areas, projects, PROJECT_ALIASES).map(m => [m.subProjectName, m.projectId]),
  )

  const bills: CockpitBill[] = []
  let unattributedCount = 0
  let unattributedClaimed = 0

  for (const b of all) {
    const projectIdForArea = areaToProject.get(clean(String(b.area ?? ''))) ?? null
    if (!projectIdForArea) {
      unattributedCount += 1
      unattributedClaimed += Number(b.claimed) || 0
      continue
    }
    if (covered.has(projectIdForArea)) bills.push(b)
  }

  return {
    bills,
    asOf,
    generatedAt,
    ageDays,
    unattributed: { count: unattributedCount, claimed: unattributedClaimed },
  }
}
