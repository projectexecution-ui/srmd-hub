// The IN4 budget sync, end to end: read IN4 → mirror into Supabase → rebuild
// the report → compare with the last upload → (live mode only) write the
// Budget Hub state the way an upload would, so everything downstream — Budget
// vs Actual V2, the Internal Estimate's ERP columns, the weekly card — keeps
// working unchanged.
//
// Two modes, one switch (app_settings.in4_budget_live):
//   shadow  — everything except the last step. The Excel upload stays the source;
//             the comparison on /budget/in4 shows how close IN4 gets.
//   live    — the sync IS the upload. The upload button stays as a fallback.
//
// Server-only, service-role. Called by the cron dispatcher twice a day and by
// the "Run now" button.

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { revalidateBudgetV2Soon } from '@/lib/budget-v2-cached'
import { extractAll, type In4Extract } from './extract'
import { buildReports, splitCode, type SubprojectReport } from './compute'
import { compareProject, summarise, type ComparisonSummary, type HubProjectData } from './compare'

export const IN4_LIVE_KEY = 'in4_budget_live'
export const IN4_LAST_SYNC_KEY = 'in4_last_sync'

export interface SyncOptions { trigger: 'cron' | 'manual'; actorId?: string | null; forceMode?: 'shadow' | 'live' }
export interface SyncResult {
  ok: boolean
  runId: number | null
  mode: 'shadow' | 'live'
  error?: string
  rowsRead: number
  subprojects: number
  linked: number
  comparison?: ComparisonSummary
  wroteBudgetHub: boolean
  budgetHubVersion?: number
  autoPull?: { ok: number; failed: number }
  startedAt: string
  finishedAt: string
}

function svc(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — the IN4 sync writes with the service role.')
  return createServiceClient(url, key, { auth: { persistSession: false } })
}

const chunk = <T,>(arr: T[], size = 500): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function upsertAll(sb: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (const batch of chunk(rows)) {
    const { error } = await sb.from(table).upsert(batch, { onConflict })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

/** Mirror the masters and facts. Replace-all semantics for the report lines
 *  (a line that vanished from IN4 must vanish here too). */
async function loadMirror(sb: SupabaseClient, x: In4Extract, reports: Map<number, SubprojectReport>) {
  const now = new Date().toISOString()
  await upsertAll(sb, 'in4_projects', x.projects.map(p => ({ ...p, synced_at: now })), 'id')
  await upsertAll(sb, 'in4_subprojects', x.subprojects.map(s => ({ ...s, synced_at: now })), 'id')
  await upsertAll(sb, 'in4_skills', x.skills.map(s => ({ id: s.id, name: s.name, code: splitCode(s.name).code || null, parent_id: s.parent_id, short_name: s.short_name, is_active: s.is_active, synced_at: now })), 'id')
  await upsertAll(sb, 'in4_work_orders', x.workOrders.map(w => ({ ...w, synced_at: now })), 'wo_id')
  await upsertAll(sb, 'in4_wo_certificates', x.certificates.map(c => ({ ...c, synced_at: now })), 'certificate_id')

  const lines: Record<string, unknown>[] = []
  for (const r of reports.values()) {
    for (const row of r.rows) lines.push({ subproject_id: r.subprojectId, cat_code: row.catNum, sub_code: '', head: row.head, budget: row.budget, wo_approved: row.woApproved, actual: row.actual, synced_at: now })
    for (const s of r.subRows) lines.push({ subproject_id: r.subprojectId, cat_code: s.catNum, sub_code: s.subNum, head: s.head, budget: s.budget, wo_approved: s.woApproved, actual: s.actual, synced_at: now })
  }
  await upsertAll(sb, 'in4_report_lines', lines, 'subproject_id,cat_code,sub_code')
  const { error } = await sb.from('in4_report_lines').delete().lt('synced_at', now)
  if (error) throw new Error(`in4_report_lines cleanup: ${error.message}`)
}

interface HubState { projects: Array<HubProjectData & { type?: string; data?: Record<string, unknown> | null; [k: string]: unknown }> }

/** Links from the upload file names: "New Guest House A-Execution - ENGG_CONSOLIDATED_…xlsx"
 *  names the IN4 sub-project exactly. Only seeds rows that do not exist yet;
 *  a manual confirmation is never overwritten. */
async function seedLinksFromFileNames(sb: SupabaseClient, state: HubState, x: In4Extract): Promise<Map<number, string>> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const byName = new Map(x.subprojects.map(s => [norm(s.name), s.id]))
  const { data: existing, error } = await sb.from('in4_subproject_links').select('subproject_id, bph_project_id')
  if (error) throw new Error(`in4_subproject_links: ${error.message}`)
  const links = new Map<number, string>((existing ?? []).map(r => [r.subproject_id as number, r.bph_project_id as string]))
  const linkedBph = new Set(links.values())
  const inserts: Record<string, unknown>[] = []
  for (const p of state.projects) {
    if (p.type === 'group' || linkedBph.has(p.id)) continue
    const file = String(p.data?.fileName ?? '')
    const m = file.match(/^(.*?)\s*-\s*ENGG_CONSOLIDATED/i)
    if (!m) continue
    const sp = byName.get(norm(m[1]))
    if (sp == null || links.has(sp)) continue
    links.set(sp, p.id); linkedBph.add(p.id)
    inserts.push({ subproject_id: sp, bph_project_id: p.id, source: 'filename' })
  }
  if (inserts.length) await upsertAll(sb, 'in4_subproject_links', inserts, 'subproject_id')

  // Every linked IN4 sub-project also becomes a known spelling in the one alias
  // table (Admin → Project name mapping): its name and its EX_CODE → the hub
  // project the Budget-Hub project is linked to. Existing rows are left alone.
  try {
    const { data: bphLinks } = await sb.from('cc_bph_project_links').select('bph_project_id, cc_project_id')
    const ccByBph = new Map((bphLinks ?? []).map(r => [r.bph_project_id as string, r.cc_project_id as string]))
    const spById = new Map(x.subprojects.map(s => [s.id, s]))
    const aliasRows: Record<string, unknown>[] = []
    for (const [spId, bph] of links) {
      const cc = ccByBph.get(bph); const sp = spById.get(spId)
      if (!cc || !sp) continue
      aliasRows.push({ source: 'in4', alias: sp.name, project_id: cc, why: 'IN4 sub-project name (from the IN4 sync)' })
      if (sp.ex_code) aliasRows.push({ source: 'in4', alias: sp.ex_code, project_id: cc, why: 'IN4 sub-project EX_CODE (from the IN4 sync)' })
    }
    for (const batch of chunk(aliasRows, 200)) {
      const { error } = await sb.from('project_aliases').upsert(batch, { onConflict: 'source,alias_norm', ignoreDuplicates: true })
      if (error) console.warn('[in4-sync] alias seed:', error.message)
    }
  } catch (e) { console.warn('[in4-sync] alias seed skipped:', e instanceof Error ? e.message : e) }
  return links
}

/** Write the rebuilt rows into budget_hub_state exactly as the Excel upload
 *  does — history snapshot, version bump, cache invalidation, then the
 *  BPH → Cost Control pull for every mapped project. */
async function writeBudgetHub(sb: SupabaseClient, state: HubState, version: number, reports: Map<number, SubprojectReport>, links: Map<number, string>, actorId: string | null) {
  const bySp = new Map<string, SubprojectReport>()
  for (const [sp, bph] of links) { const r = reports.get(sp); if (r) bySp.set(bph, r) }
  const stamp = Date.now()
  const nextProjects = state.projects.map(p => {
    const r = bySp.get(p.id)
    if (!r) return p
    return {
      ...p,
      data: {
        ...(p.data ?? {}),
        format: 'IN4',
        fileName: `IN4 live sync ${new Date(stamp).toISOString().slice(0, 10)}`,
        dataAsOf: stamp,
        parsedAt: stamp,
        rows: r.rows,
        subRows: r.subRows,
      },
    }
  })

  const { error: snapErr } = await sb.from('budget_hub_state_history').insert({ state_id: 'global', state, version, snapshot_by: actorId })
  if (snapErr) console.warn('[in4-sync] history snapshot failed:', snapErr.message)
  const newVersion = version + 1
  const { error: updErr } = await sb.from('budget_hub_state')
    .update({ state: { ...state, projects: nextProjects }, version: newVersion, updated_at: new Date().toISOString(), updated_by: actorId })
    .eq('id', 'global')
  if (updErr) throw new Error(`budget_hub_state: ${updErr.message}`)
  revalidateBudgetV2Soon()

  let autoPull = { ok: 0, failed: 0 }
  try {
    const { runAllMappedPulls } = await import('@/app/(app)/cost-control/import/bph/actions')
    const r = await runAllMappedPulls({ client: sb, actorId })
    autoPull = { ok: r.outcomes.filter(o => o.ok).length, failed: r.outcomes.filter(o => !o.ok).length }
  } catch (e) {
    console.warn('[in4-sync] BPH → Cost Control pull failed:', e instanceof Error ? e.message : e)
  }
  return { newVersion, autoPull }
}

export async function runIn4Sync(opts: SyncOptions): Promise<SyncResult> {
  const sb = svc()
  const startedAt = new Date().toISOString()
  const { data: liveRow } = await sb.from('app_settings').select('value').eq('key', IN4_LIVE_KEY).maybeSingle()
  const mode: 'shadow' | 'live' = opts.forceMode ?? (String(liveRow?.value ?? 'false') === 'true' ? 'live' : 'shadow')

  const { data: runRow } = await sb.from('in4_sync_runs').insert({ trigger: opts.trigger, mode, actor_id: opts.actorId ?? null }).select('id').single()
  const runId = (runRow?.id as number | undefined) ?? null
  const finish = async (patch: Record<string, unknown>) => {
    if (runId != null) await sb.from('in4_sync_runs').update({ finished_at: new Date().toISOString(), ...patch }).eq('id', runId)
  }

  try {
    const x = await extractAll()
    const rowsRead = Object.values(x).reduce((t, arr) => t + (Array.isArray(arr) ? arr.length : 0), 0)
    const reports = buildReports(x)

    const { data: stateRow, error: stateErr } = await sb.from('budget_hub_state').select('state, version').eq('id', 'global').single()
    if (stateErr) throw new Error(`budget_hub_state: ${stateErr.message}`)
    const state = (stateRow.state ?? { projects: [] }) as HubState
    const version = Number(stateRow.version ?? 0)

    const links = await seedLinksFromFileNames(sb, state, x)
    await loadMirror(sb, x, reports)

    // Shadow comparison: for every linked project, IN4 today vs the stored upload.
    const byBph = new Map(state.projects.map(p => [p.id, p]))
    const comparisons = []
    for (const [sp, bph] of links) {
      const hub = byBph.get(bph); const r = reports.get(sp)
      if (hub && r) comparisons.push(compareProject(hub, r, sp))
    }
    const comparison = summarise(comparisons)

    let wroteBudgetHub = false, budgetHubVersion: number | undefined, autoPull: { ok: number; failed: number } | undefined
    if (mode === 'live') {
      const w = await writeBudgetHub(sb, state, version, reports, links, opts.actorId ?? null)
      wroteBudgetHub = true; budgetHubVersion = w.newVersion; autoPull = w.autoPull
    }

    const result: SyncResult = {
      ok: true, runId, mode, rowsRead, subprojects: reports.size, linked: links.size, comparison,
      wroteBudgetHub, budgetHubVersion, autoPull, startedAt, finishedAt: new Date().toISOString(),
    }
    await finish({ ok: true, rows_read: rowsRead, subprojects: reports.size, linked: links.size, compared: comparison, wrote_budget_hub: wroteBudgetHub })
    // A small pointer every page can read without touching the runs table.
    await sb.from('app_settings').upsert({ key: IN4_LAST_SYNC_KEY, value: JSON.stringify({
      at: result.finishedAt, mode, ok: true, linked: links.size, subprojects: reports.size,
      exact: comparison.totals.exact, near: comparison.totals.near, off: comparison.totals.off, figures: comparison.totals.figures,
      wroteBudgetHub, budgetHubVersion,
    }) }, { onConflict: 'key' })
    return result
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await finish({ ok: false, error })
    await sb.from('app_settings').upsert({ key: IN4_LAST_SYNC_KEY, value: JSON.stringify({ at: new Date().toISOString(), mode, ok: false, error }) }, { onConflict: 'key' })
    return { ok: false, runId, mode, error, rowsRead: 0, subprojects: 0, linked: 0, wroteBudgetHub: false, startedAt, finishedAt: new Date().toISOString() }
  }
}

export interface LastSync {
  at: string; mode: 'shadow' | 'live'; ok: boolean; error?: string
  linked?: number; subprojects?: number; exact?: number; near?: number; off?: number; figures?: number
  wroteBudgetHub?: boolean; budgetHubVersion?: number
}

/** Cheap read for status chips. Works with any Supabase client. */
export async function readLastSync(sb: { from: SupabaseClient['from'] }): Promise<LastSync | null> {
  const { data } = await sb.from('app_settings').select('value').eq('key', IN4_LAST_SYNC_KEY).maybeSingle()
  if (!data?.value) return null
  try { return JSON.parse(String(data.value)) as LastSync } catch { return null }
}
