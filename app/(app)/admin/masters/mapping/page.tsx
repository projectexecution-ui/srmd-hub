import { createClient } from '@/lib/supabase/server'
import { getMyProfile, requirePermission } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { loadAliasMap, normAlias, type AliasSource } from '@/lib/aliases'
import { MappingClient, type MappingRow, type ProjectOption } from './client'

export const dynamic = 'force-dynamic'

// The one screen where "what does IN4 / the BPH report / the procurement
// upload / Zoho call this project" is decided. Every name those systems have
// sent us is listed; each is either mapped to a hub project, marked not ours
// (with the reason), or still open — open ones first, because they are the
// money currently attached to nothing.
export default async function MappingPage() {
  await requirePermission('admin-settings', 'view', '/admin')
  const profile = await getMyProfile()
  if (!profile || (profile.role !== 'admin' && !profile.is_portal_owner)) redirect('/admin')
  const supabase = await createClient()

  const [projectsRes, in4Res, procRes, stateRes, aliases] = await Promise.all([
    supabase.from('projects').select('id, code, name, parent_project_id, archived_at').order('code'),
    supabase.from('in4_subprojects').select('id, name, ex_code, is_active').eq('is_active', true).order('name'),
    supabase.from('procurement_known_projects').select('name').order('name'),
    supabase.from('budget_hub_state').select('state').eq('id', 'global').maybeSingle(),
    loadAliasMap(supabase),
  ])

  const projects: ProjectOption[] = ((projectsRes.data ?? []) as Array<{ id: string; code: string; name: string; archived_at: string | null }>)
    .filter(p => !p.archived_at)
    .map(p => ({ id: p.id, code: p.code, name: p.name }))
  const projById = new Map(projects.map(p => [p.id, p]))

  type Cand = { source: AliasSource; alias: string; hint: string }
  const cands: Cand[] = []
  for (const s of (in4Res.data ?? []) as Array<{ id: number; name: string; ex_code: string | null }>) cands.push({ source: 'in4', alias: s.name, hint: s.ex_code ? `EX_CODE ${s.ex_code}` : '' })
  for (const r of (procRes.data ?? []) as Array<{ name: string }>) cands.push({ source: 'procurement', alias: r.name, hint: 'Indent → PO upload' })
  const bph = ((stateRes.data?.state as { projects?: Array<{ name?: string; type?: string }> } | null)?.projects ?? []).filter(p => p.type !== 'group' && p.name)
  for (const p of bph) cands.push({ source: 'bph', alias: p.name!, hint: 'Budget-Hub project' })
  // Aliases that exist but whose name no source currently sends (bills report,
  // zoho, manual) still deserve a row so they can be edited.
  const seen = new Set(cands.map(c => `${c.source}|${normAlias(c.alias)}`))
  for (const { row } of aliases.values()) {
    const k = `${row.source}|${row.alias_norm}`
    if (!seen.has(k)) { cands.push({ source: row.source, alias: row.alias, hint: row.source === 'zoho' ? 'Bills Pipeline code' : row.source === 'bills-report' ? 'Daily bills report' : 'Added by hand' }); seen.add(k) }
  }

  const rows: MappingRow[] = cands.map(c => {
    const hit = aliases.get(normAlias(c.alias))
    // A hit from a DIFFERENT source is not a mapping for this one — the table is
    // keyed per source on purpose (IN4's "P2 Infra" and Zoho's "P2" differ).
    const own = hit && hit.row.source === c.source ? hit : undefined
    const proj = own?.projectId ? projById.get(own.projectId) : undefined
    return {
      source: c.source, alias: c.alias, hint: c.hint,
      state: own ? (own.projectId ? 'mapped' : 'not-ours') : 'open',
      projectId: own?.projectId ?? null,
      projectLabel: proj ? `${proj.code} · ${proj.name}` : null,
      why: own?.row.why ?? null,
      confidence: own?.row.confidence ?? null,
    }
  })
  const order = { open: 0, 'not-ours': 1, mapped: 2 }
  rows.sort((a, b) => order[a.state] - order[b.state] || a.source.localeCompare(b.source) || a.alias.localeCompare(b.alias))

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Project name mapping"
        back="/admin"
        subtitle="What IN4, the budget report, the procurement upload and Zoho call each of our projects. Open names are money attached to nothing yet."
      />
      <MappingClient rows={rows} projects={projects} />
    </div>
  )
}
