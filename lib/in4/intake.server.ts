// IN4 → hub intake: the reads and writes. The deciding is in intake.ts.
//
// Every write goes through the SERVICE client after the caller has checked
// the gate (admin, or named in in4_intake_users — Parimal), because the
// Budget-Hub state, the link tables and the alias table are not something a
// person's own session should be writing to row by row.

import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js'
import { kindOf } from '@/lib/projects/kind'
import {
  classifySubproject, autoAdopts, planIntake, bphEntryFor, type IntakeKind, type IntakeRowIn,
} from './intake'

export function intakeServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  return url && key ? createServiceClient(url, key, { auth: { persistSession: false } }) : null
}

export interface IntakeRow extends IntakeRowIn {
  kind: IntakeKind
  exCode: string | null
  /** Where it would go: the group's label, or "new group <name>". */
  goesUnder: string
}

/** IN4 project id → the hub GROUP a sibling already lives under, via the
 *  three-hop chain (sub-project → BPH project → hub project → its group). */
async function groupsByIn4Project(sb: SupabaseClient): Promise<{ map: Map<number, string>; label: Map<string, string> }> {
  const [{ data: links }, { data: bph }, { data: projects }, { data: sps }] = await Promise.all([
    sb.from('in4_subproject_links').select('subproject_id, bph_project_id'),
    sb.from('cc_bph_project_links').select('bph_project_id, cc_project_id'),
    sb.from('projects').select('id, code, name, parent_project_id, project_type').is('archived_at', null),
    sb.from('in4_subprojects').select('id, project_id'),
  ])
  const ccByBph = new Map((bph ?? []).map(r => [r.bph_project_id as string, r.cc_project_id as string]))
  const proj = new Map((projects ?? []).map(p => [p.id as string, p]))
  const in4ProjectOfSp = new Map((sps ?? []).map(s => [s.id as number, s.project_id as number]))
  const map = new Map<number, string>()
  const label = new Map<string, string>()
  for (const p of projects ?? []) label.set(p.id as string, (p.code as string) || (p.name as string))
  for (const l of links ?? []) {
    const cc = ccByBph.get(l.bph_project_id as string)
    const in4p = in4ProjectOfSp.get(l.subproject_id as number)
    if (!cc || in4p == null || map.has(in4p)) continue
    const hub = proj.get(cc)
    if (!hub) continue
    // The group above the sibling, or the sibling itself when it is a group.
    if (kindOf(hub.project_type as string | null) === 'group') { map.set(in4p, hub.id as string); continue }
    const par = hub.parent_project_id ? proj.get(hub.parent_project_id as string) : null
    if (par && kindOf(par.project_type as string | null) === 'group') map.set(in4p, par.id as string)
  }
  return { map, label }
}

/** Everything waiting, with where each would go. */
export async function listIntake(sb: SupabaseClient): Promise<IntakeRow[]> {
  const [{ data: waiting }, { data: sps }, { data: in4Projects }, groups] = await Promise.all([
    sb.from('in4_hub_intake').select('subproject_id, first_seen_at').eq('status', 'new'),
    sb.from('in4_subprojects').select('id, project_id, name, ex_code, is_active, construction_area_ft, budget'),
    sb.from('in4_projects').select('id, name'),
    groupsByIn4Project(sb),
  ])
  const spById = new Map((sps ?? []).map(s => [s.id as number, s]))
  const pName = new Map((in4Projects ?? []).map(p => [p.id as number, p.name as string]))
  const rows: IntakeRow[] = []
  for (const w of waiting ?? []) {
    const s = spById.get(w.subproject_id as number)
    if (!s || !s.is_active) continue
    const in4ProjectName = pName.get(s.project_id as number) ?? 'IN4'
    const g = groups.map.get(s.project_id as number)
    rows.push({
      subprojectId: s.id as number, name: s.name as string, in4ProjectId: s.project_id as number, in4ProjectName,
      areaFt: s.construction_area_ft != null ? Number(s.construction_area_ft) : null,
      budget: s.budget != null ? Number(s.budget) : null,
      firstSeenAt: w.first_seen_at as string,
      kind: classifySubproject(s.name as string),
      exCode: (s.ex_code as string | null) ?? null,
      goesUnder: g ? (groups.label.get(g) ?? 'its group') : `a new group “${in4ProjectName}”`,
    })
  }
  return rows.sort((a, b) => a.in4ProjectName.localeCompare(b.in4ProjectName) || a.name.localeCompare(b.name))
}

/** Bring the given sub-projects into the hub: a hub project each, marked
 *  "Not finished", under the group for its IN4 project (created if none), a
 *  Budget-Hub entry and the links so the next budget run fills its figures,
 *  an alias so the name matches, and the intake row marked added. */
export async function adoptSubprojects(
  sb: SupabaseClient, ids: number[], actorId: string | null, note: string,
): Promise<{ added: number; groupsCreated: number; error?: string }> {
  if (ids.length === 0) return { added: 0, groupsCreated: 0 }
  const [{ data: waiting }, { data: sps }, { data: in4Projects }, groups, { data: codes }] = await Promise.all([
    sb.from('in4_hub_intake').select('subproject_id').eq('status', 'new').in('subproject_id', ids),
    sb.from('in4_subprojects').select('id, project_id, name, ex_code, construction_area_ft, budget').in('id', ids),
    sb.from('in4_projects').select('id, name'),
    groupsByIn4Project(sb),
    sb.from('projects').select('code'),
  ])
  const allowed = new Set((waiting ?? []).map(w => w.subproject_id as number))
  const pName = new Map((in4Projects ?? []).map(p => [p.id as number, p.name as string]))
  const rows: IntakeRowIn[] = (sps ?? []).filter(s => allowed.has(s.id as number)).map(s => ({
    subprojectId: s.id as number, name: s.name as string, in4ProjectId: s.project_id as number,
    in4ProjectName: pName.get(s.project_id as number) ?? 'IN4',
    areaFt: s.construction_area_ft != null ? Number(s.construction_area_ft) : null,
    budget: s.budget != null ? Number(s.budget) : null, firstSeenAt: '',
  }))
  if (rows.length === 0) return { added: 0, groupsCreated: 0 }
  const exCodeOf = new Map((sps ?? []).map(s => [s.id as number, (s.ex_code as string | null) ?? null]))

  const plan = planIntake(rows, { groupByIn4Project: groups.map, takenCodes: new Set((codes ?? []).map(c => c.code as string)) })

  // 1. Groups that do not exist yet — one per IN4 project.
  const groupIdByCode = new Map<string, string>()
  let groupsCreated = 0
  for (const p of plan) {
    if (!('create' in p.parent) || groupIdByCode.has(p.parent.create.code)) continue
    const { data, error } = await sb.from('projects')
      .insert({ name: p.parent.create.name, code: p.parent.create.code, project_type: 'group', group_label: p.parent.create.name, cc_status: 'active', setup_progress_pct: 100 })
      .select('id').single()
    if (error || !data) return { added: 0, groupsCreated, error: `Could not create the group ${p.parent.create.name}: ${error?.message ?? 'no row'}` }
    groupIdByCode.set(p.parent.create.code, data.id as string)
    groupsCreated++
  }

  // 2. The hub projects, "Not finished".
  const created: Array<{ subprojectId: number; hubId: string; name: string }> = []
  for (const p of plan) {
    const row = rows.find(r => r.subprojectId === p.subprojectId)!
    const parentId = 'id' in p.parent ? p.parent.id : groupIdByCode.get(p.parent.create.code)!
    const { data, error } = await sb.from('projects')
      .insert({ name: p.name, code: p.code, project_type: 'project', parent_project_id: parentId, built_up_sft: row.areaFt, cc_status: 'setup_incomplete', setup_progress_pct: 20 })
      .select('id').single()
    if (error || !data) return { added: created.length, groupsCreated, error: `Could not create ${p.name}: ${error?.message ?? 'no row'}` }
    created.push({ subprojectId: p.subprojectId, hubId: data.id as string, name: p.name })
  }

  // 3. The Budget-Hub entries — the middle hop of the chain — with the same
  //    history snapshot and version bump the upload and the sync make.
  const { data: stateRow, error: stateErr } = await sb.from('budget_hub_state').select('state, version').eq('id', 'global').maybeSingle()
  if (stateErr || !stateRow) return { added: created.length, groupsCreated, error: `budget_hub_state: ${stateErr?.message ?? 'missing'}` }
  const state = stateRow.state as { projects?: unknown[] } & Record<string, unknown>
  const version = Number(stateRow.version ?? 0)
  const nowMs = Date.now()
  const nextState = { ...state, projects: [...(state.projects ?? []), ...created.map(c => bphEntryFor(c.subprojectId, c.name, nowMs))] }
  await sb.from('budget_hub_state_history').insert({ state_id: 'global', state, version, snapshot_by: actorId })
  const { error: updErr } = await sb.from('budget_hub_state').update({ state: nextState, version: version + 1, updated_at: new Date(nowMs).toISOString(), updated_by: actorId }).eq('id', 'global')
  if (updErr) return { added: created.length, groupsCreated, error: `budget_hub_state: ${updErr.message}` }

  // 4. The links and the aliases.
  const now = new Date(nowMs).toISOString()
  const linkRows = created.map(c => ({ subproject_id: c.subprojectId, bph_project_id: `ctin4${c.subprojectId}`, source: 'intake', note, confirmed_by: actorId, confirmed_at: now }))
  const { error: l1 } = await sb.from('in4_subproject_links').upsert(linkRows, { onConflict: 'subproject_id' })
  if (l1) return { added: created.length, groupsCreated, error: `in4_subproject_links: ${l1.message}` }
  const { error: l2 } = await sb.from('cc_bph_project_links').insert(created.map(c => ({ bph_project_id: `ctin4${c.subprojectId}`, cc_project_id: c.hubId, created_by: actorId })))
  if (l2) return { added: created.length, groupsCreated, error: `cc_bph_project_links: ${l2.message}` }
  const aliasRows: Record<string, unknown>[] = []
  for (const c of created) {
    aliasRows.push({ source: 'in4', alias: c.name, project_id: c.hubId, why: 'IN4 sub-project name (brought in from IN4)' })
    const ex = exCodeOf.get(c.subprojectId)
    if (ex) aliasRows.push({ source: 'in4', alias: ex, project_id: c.hubId, why: 'IN4 sub-project EX_CODE (brought in from IN4)' })
  }
  if (aliasRows.length) await sb.from('project_aliases').upsert(aliasRows, { onConflict: 'source,alias_norm', ignoreDuplicates: true })

  // 5. The intake rows.
  for (const c of created) {
    await sb.from('in4_hub_intake').update({ status: 'added', hub_project_id: c.hubId, decided_by: actorId, decided_at: now, note }).eq('subproject_id', c.subprojectId)
  }
  return { added: created.length, groupsCreated }
}

export async function skipSubprojects(sb: SupabaseClient, ids: number[], actorId: string | null): Promise<{ skipped: number; error?: string }> {
  if (ids.length === 0) return { skipped: 0 }
  const { data, error } = await sb.from('in4_hub_intake')
    .update({ status: 'skipped', decided_by: actorId, decided_at: new Date().toISOString(), note: 'skipped by hand' })
    .eq('status', 'new').in('subproject_id', ids).select('subproject_id')
  if (error) return { skipped: 0, error: error.message }
  return { skipped: (data ?? []).length }
}

/** Called by the masters feed after it has mirrored in4_subprojects: record
 *  every active sub-project the hub does not hold and has not met, then bring
 *  in at once the ones that are Execution work (N1). Everything else waits on
 *  Data › From IN4. */
export async function recordNewArrivals(sb: SupabaseClient, now: string): Promise<{ recorded: number; adopted: number; error?: string }> {
  const [{ data: sps }, { data: links }, { data: bph }, { data: known }] = await Promise.all([
    sb.from('in4_subprojects').select('id, name').eq('is_active', true),
    sb.from('in4_subproject_links').select('subproject_id, bph_project_id'),
    sb.from('cc_bph_project_links').select('bph_project_id'),
    sb.from('in4_hub_intake').select('subproject_id'),
  ])
  const linkedBph = new Set((bph ?? []).map(b => b.bph_project_id as string))
  const held = new Set((links ?? []).filter(l => linkedBph.has(l.bph_project_id as string)).map(l => l.subproject_id as number))
  const met = new Set((known ?? []).map(k => k.subproject_id as number))
  const arrivals = (sps ?? []).filter(s => !held.has(s.id as number) && !met.has(s.id as number))
  if (arrivals.length === 0) return { recorded: 0, adopted: 0 }
  const { error } = await sb.from('in4_hub_intake').insert(arrivals.map(s => ({ subproject_id: s.id as number, first_seen_at: now, status: 'new', note: 'arrived from the IN4 sync' })))
  if (error) return { recorded: 0, adopted: 0, error: error.message }
  const auto = arrivals.filter(s => autoAdopts(classifySubproject(s.name as string))).map(s => s.id as number)
  const r = await adoptSubprojects(sb, auto, null, 'brought in by the IN4 sync')
  return { recorded: arrivals.length, adopted: r.added, error: r.error }
}

/** For the Today strip. */
export async function intakeSummary(sb: { from: SupabaseClient['from'] }): Promise<{ waiting: number; arrivedRecently: number }> {
  const since = new Date(Date.now() - 2 * 24 * 3_600_000).toISOString()
  const [w, a] = await Promise.all([
    sb.from('in4_hub_intake').select('subproject_id', { count: 'exact', head: true }).eq('status', 'new'),
    sb.from('in4_hub_intake').select('subproject_id', { count: 'exact', head: true }).eq('status', 'added').like('note', 'brought in by the IN4 sync%').gte('decided_at', since),
  ])
  return { waiting: w.count ?? 0, arrivedRecently: a.count ?? 0 }
}
