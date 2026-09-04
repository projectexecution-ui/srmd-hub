// The Bills Pipeline names projects by Zoho's short billing code (NGH, P2, VV,
// RU, SRAH …). The rest of the hub names them from the project master. This is
// the bridge: code → the hub project it maps to (through project_aliases,
// source 'zoho'), so the digest, its settings and the cards can say "New Guest
// House" where the hub does, and fall back to Zoho's own name — never a guess —
// where no mapping exists yet (RU and RH: not in CT Hub yet).

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSelectedProjects } from './projects'

export interface BillsProjectLabel {
  code: string
  /** What to show a person: the hub project's name, else Zoho's, else the code. */
  label: string
  hubProjectId: string | null
  hubCode: string | null
  zohoName: string | null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function billsProjectLabels(sb: SupabaseClient<any, any, any>): Promise<Map<string, BillsProjectLabel>> {
  const [selected, aliasRes, projRes] = await Promise.all([
    getSelectedProjects(sb),
    sb.from('project_aliases').select('alias_norm, project_id').eq('source', 'zoho'),
    sb.from('projects').select('id, code, name').is('archived_at', null),
  ])
  const byNorm = new Map<string, string | null>(((aliasRes.data ?? []) as Array<{ alias_norm: string; project_id: string | null }>).map(a => [a.alias_norm, a.project_id]))
  const projects = new Map<string, { code: string; name: string }>(((projRes.data ?? []) as Array<{ id: string; code: string; name: string }>).map(p => [p.id, { code: p.code, name: p.name }]))

  const out = new Map<string, BillsProjectLabel>()
  for (const p of selected) {
    const hubId = byNorm.get(norm(p.code)) ?? null
    const hub = hubId ? projects.get(hubId) : undefined
    out.set(p.code, {
      code: p.code,
      label: hub?.name ?? p.name ?? p.code,
      hubProjectId: hub ? hubId : null,
      hubCode: hub?.code ?? null,
      zohoName: p.name ?? null,
    })
  }
  return out
}

/** "New Guest House (NGH)" — the hub name with the billing code it came from. */
export function billsProjectDisplay(l: BillsProjectLabel | undefined, code: string): string {
  if (!l || l.label === code) return code
  return `${l.label} (${code})`
}
