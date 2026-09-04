// Resolving a project name that came from another system (IN4, the BPH
// report, Zoho, the bills report, the procurement upload) to a hub project.
//
// One table, project_aliases, holds every known spelling per source. This
// module is the only way to read it, so every importer resolves names the
// same way — exact match on the normalised alias, never fuzzy. A name that is
// not in the table is UNRESOLVED and stays visible as such; the Mapping screen
// (/admin/masters/mapping) is where a person decides what it is.

import type { SupabaseClient } from '@supabase/supabase-js'

export type AliasSource = 'in4' | 'bph' | 'zoho' | 'bills-report' | 'procurement' | 'manual'

export interface AliasRow {
  id: number
  source: AliasSource
  alias: string
  alias_norm: string
  /** null = deliberately not ours (see why) */
  project_id: string | null
  confidence: 'certain' | 'likely'
  why: string | null
}

/** The same normalisation the database column uses. */
export function normAlias(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export type AliasMap = Map<string, { projectId: string | null; row: AliasRow }>

/** Every alias for one source (or all sources), keyed by normalised alias. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadAliasMap(sb: SupabaseClient<any, any, any>, source?: AliasSource): Promise<AliasMap> {
  let q = sb.from('project_aliases').select('id, source, alias, alias_norm, project_id, confidence, why')
  if (source) q = q.eq('source', source)
  const { data, error } = await q
  if (error) throw new Error(`project_aliases: ${error.message}`)
  const map: AliasMap = new Map()
  for (const r of (data ?? []) as AliasRow[]) map.set(r.alias_norm, { projectId: r.project_id, row: r })
  return map
}

export type Resolution =
  | { kind: 'project'; projectId: string; row: AliasRow }
  | { kind: 'not-ours'; row: AliasRow }
  | { kind: 'unknown' }

/** Exact (normalised) lookup. `unknown` means nobody has decided yet. */
export function resolveAlias(map: AliasMap, name: string): Resolution {
  const hit = map.get(normAlias(name))
  if (!hit) return { kind: 'unknown' }
  if (hit.projectId) return { kind: 'project', projectId: hit.projectId, row: hit.row }
  return { kind: 'not-ours', row: hit.row }
}
