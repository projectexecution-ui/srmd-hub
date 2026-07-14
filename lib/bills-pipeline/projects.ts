import type { SupabaseClient } from '@supabase/supabase-js'
import { BP_CONFIG } from './config'

export interface BpProject {
  code: string   // short badge, e.g. "NGH"
  id:   string   // Zoho project id
  name?: string  // full Zoho project name
}

export const PROJECTS_KEY = 'bills_pipeline_projects'

// The original hardcoded set — used as the fallback when nothing is saved.
export const DEFAULT_PROJECTS: BpProject[] =
  Object.entries(BP_CONFIG.PROJECTS).map(([code, id]) => ({ code, id: id as string }))

const DEFAULT_BY_ID = new Map(DEFAULT_PROJECTS.map(p => [p.id, p.code]))

// A short badge code from a Zoho project name ("Billing - CV - SRA" -> "CV").
// Known projects keep their nice code.
export function codeForProject(id: string, name: string): string {
  const known = DEFAULT_BY_ID.get(id)
  if (known) return known
  const parts = name.split('-').map(s => s.trim()).filter(Boolean)
  const mid = parts.length >= 2 ? parts[1] : (parts[0] ?? name)
  const compact = mid.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  return compact.slice(0, 6) || 'PRJ'
}

// The projects the reports should cover — the admin's saved selection, or the
// default six if nothing has been saved yet.
export async function getSelectedProjects(supabase: SupabaseClient): Promise<BpProject[]> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', PROJECTS_KEY)
    .maybeSingle()

  if (data?.value) {
    try {
      const arr = JSON.parse(data.value as string) as BpProject[]
      if (Array.isArray(arr) && arr.length && arr.every(p => p?.code && p?.id)) return arr
    } catch { /* fall through to default */ }
  }
  return DEFAULT_PROJECTS
}
