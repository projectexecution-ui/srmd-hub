// Server loaders for Budget vs Actual's three pills (build order §2).
//
// The arithmetic lives in budget-actual.ts and is unit-tested against NGH B.
// This file only fetches — so a wrong figure is always a bug in one pure
// function with a test around it, never in a query nobody can run twice.
//
// Every loader returns its Supabase `error` rather than swallowing it. §10:
// show the error, never a silent empty state.

import { createClient } from '@/lib/supabase/server'
import {
  buildBudgetActual, buildKpis,
  type BudgetActual, type BudgetLineRow, type SheetRow, type CategoryRef, type SubSkillRef, type Kpi,
} from './budget-actual'

export interface PillOne {
  table: BudgetActual
  kpis: Kpi[]
  areaSft: number | null
  error: string | null
}

interface DisciplineJoin { id: string; code: string | null; name: string; display_order: number | null }
interface SubSkillJoin { id: string; discipline_id: string; code: string | null; name: string }
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

/**
 * Pill 1 — Category / sub-category wise.
 *
 * The categories are the ones ENABLED on this project (`cc_project_disciplines`),
 * not the whole master: a project's table should show the trades it actually
 * runs. Budget lines and working sheets are read whole for the project, so a
 * line sitting on a category nobody enabled still reaches the totals rather
 * than vanishing.
 */
export async function loadCategoryWise(projectId: string): Promise<PillOne> {
  const supabase = await createClient()

  const [projRes, discRes, subRes, blRes, wsRes, verRes] = await Promise.all([
    supabase.from('projects').select('built_up_sft').eq('id', projectId).maybeSingle(),
    supabase.from('cc_project_disciplines')
      .select('discipline_id, cc_disciplines(id, code, name, display_order)')
      .eq('project_id', projectId),
    supabase.from('cc_project_sub_skills')
      .select('sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
      .eq('project_id', projectId),
    supabase.from('cc_budget_lines')
      .select('discipline_id, sub_skill_id, internal_estimate_amt, current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', projectId),
    supabase.from('cc_working_sheets')
      .select('id, discipline_id, sub_skill_id, status, total_amount')
      .eq('project_id', projectId).is('archived_at', null),
    // Only the versions view knows chain identity; the base table cannot
    // compute it. Without this every earlier revision would be counted again.
    supabase.from('cc_ws_with_versions')
      .select('id, chain_anchor_id, version_no')
      .eq('project_id', projectId).is('archived_at', null),
  ])

  const err = blRes.error ?? wsRes.error ?? discRes.error ?? subRes.error ?? verRes.error
  const areaSft = projRes.data?.built_up_sft != null ? Number(projRes.data.built_up_sft) : null

  if (err) {
    const empty = buildBudgetActual({ categories: [], subSkills: [], budgetLines: [], sheets: [] })
    return { table: empty, kpis: buildKpis(empty.totals, areaSft), areaSft, error: err.message }
  }

  const chain = new Map<string, { anchor: string | null; ver: number | null }>()
  for (const v of (verRes.data ?? []) as Array<{ id: string; chain_anchor_id: string | null; version_no: number | null }>) {
    chain.set(v.id, { anchor: v.chain_anchor_id, ver: v.version_no })
  }

  const sheets: SheetRow[] = ((wsRes.data ?? []) as Array<Record<string, unknown>>).map(w => {
    const c = chain.get(w.id as string)
    return {
      id: w.id as string,
      discipline_id: (w.discipline_id as string | null) ?? null,
      sub_skill_id: (w.sub_skill_id as string | null) ?? null,
      status: String(w.status ?? ''),
      total_amount: w.total_amount != null ? Number(w.total_amount) : null,
      chain_anchor_id: c?.anchor ?? null,
      version_no: c?.ver ?? 1,
    }
  })

  const budgetLines: BudgetLineRow[] = ((blRes.data ?? []) as Array<Record<string, unknown>>).map(b => ({
    discipline_id: (b.discipline_id as string | null) ?? null,
    sub_skill_id: (b.sub_skill_id as string | null) ?? null,
    internal_estimate_amt: b.internal_estimate_amt != null ? Number(b.internal_estimate_amt) : null,
    current_budget_amt: b.current_budget_amt != null ? Number(b.current_budget_amt) : null,
    current_wo_committed_amt: b.current_wo_committed_amt != null ? Number(b.current_wo_committed_amt) : null,
    current_paid_amt: b.current_paid_amt != null ? Number(b.current_paid_amt) : null,
  }))

  const discRows = ((discRes.data ?? []) as Array<{ cc_disciplines: DisciplineJoin | DisciplineJoin[] | null }>)
    .map(r => one(r.cc_disciplines)).filter((d): d is DisciplineJoin => !!d)
  const subRows = ((subRes.data ?? []) as Array<{ cc_sub_skills: SubSkillJoin | SubSkillJoin[] | null }>)
    .map(r => one(r.cc_sub_skills)).filter((s): s is SubSkillJoin => !!s)

  // A budget line or sheet on a category nobody enabled still has to appear —
  // otherwise real money silently leaves the table.
  const known = new Set(discRows.map(d => d.id))
  const extra = new Set<string>()
  for (const b of budgetLines) if (b.discipline_id && !known.has(b.discipline_id)) extra.add(b.discipline_id)
  for (const s of sheets) if (s.discipline_id && !known.has(s.discipline_id)) extra.add(s.discipline_id)

  let extraDisc: DisciplineJoin[] = []
  let extraSubs: SubSkillJoin[] = []
  if (extra.size > 0) {
    const [d2, s2] = await Promise.all([
      supabase.from('cc_disciplines').select('id, code, name, display_order').in('id', [...extra]),
      supabase.from('cc_sub_skills').select('id, discipline_id, code, name').in('discipline_id', [...extra]),
    ])
    extraDisc = (d2.data ?? []) as DisciplineJoin[]
    extraSubs = (s2.data ?? []) as SubSkillJoin[]
  }

  // A sub-skill carrying money but not enabled on the project must appear too.
  const allSubIds = new Set([...subRows, ...extraSubs].map(s => s.id))
  const missingSubs = new Set<string>()
  for (const b of budgetLines) if (b.sub_skill_id && !allSubIds.has(b.sub_skill_id)) missingSubs.add(b.sub_skill_id)
  for (const s of sheets) if (s.sub_skill_id && !allSubIds.has(s.sub_skill_id)) missingSubs.add(s.sub_skill_id)
  let orphanSubs: SubSkillJoin[] = []
  if (missingSubs.size > 0) {
    const { data } = await supabase.from('cc_sub_skills')
      .select('id, discipline_id, code, name').in('id', [...missingSubs])
    orphanSubs = (data ?? []) as SubSkillJoin[]
  }

  const byId = new Map<string, DisciplineJoin>()
  for (const d of [...discRows, ...extraDisc]) byId.set(d.id, d)
  const categories: CategoryRef[] = [...byId.values()]
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true })
      || a.name.localeCompare(b.name))
    .map(d => ({ id: d.id, code: d.code, name: d.name }))

  const subById = new Map<string, SubSkillJoin>()
  for (const s of [...subRows, ...extraSubs, ...orphanSubs]) subById.set(s.id, s)
  const subSkills: SubSkillRef[] = [...subById.values()]
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', undefined, { numeric: true })
      || a.name.localeCompare(b.name))
    .map(s => ({ id: s.id, discipline_id: s.discipline_id, code: s.code, name: s.name }))

  const table = buildBudgetActual({ categories, subSkills, budgetLines, sheets })
  return { table, kpis: buildKpis(table.totals, areaSft), areaSft, error: null }
}

export interface CtWiseRow {
  subprojectId: number
  name: string
  areaSft: number | null
  budgetErp: number | null
  woApproved: number | null
  /** ERP budget − WO/PO approved. Stated as a subtraction of two figures IN4
   *  holds, which §10 allows; nothing here is reverse-engineered from a rate. */
  uncommitted: number | null
  certified: number | null
  pctUsed: number | null
}

export interface CtWise { rows: CtWiseRow[]; total: CtWiseRow | null; error: string | null; note: string }

/**
 * Pill 3 — CT wise. One row per IN4 sub-project, flat, no drill-down.
 *
 * IN4 sub-projects are the only sub-division the mirror holds. Scope: the IN4
 * project this CT Hub project is linked to, so a group shows its buildings and
 * a single building shows itself.
 */
export async function loadCtWise(projectId: string): Promise<CtWise> {
  const supabase = await createClient()
  const note = 'These are IN4 sub-projects — the only project sub-division the mirror holds. '
    + 'Uncommitted = ERP budget − WO/PO approved.'

  const { data: links, error: linkErr } = await supabase
    .from('cc_bph_project_links').select('bph_project_id').eq('cc_project_id', projectId)
  if (linkErr) return { rows: [], total: null, error: linkErr.message, note }

  const bphIds = (links ?? []).map(r => r.bph_project_id as string).filter(Boolean)
  if (bphIds.length === 0) return { rows: [], total: null, error: null, note }

  const { data: subLinks, error: subErr } = await supabase
    .from('in4_subproject_links').select('subproject_id').in('bph_project_id', bphIds)
  if (subErr) return { rows: [], total: null, error: subErr.message, note }

  const subIds = (subLinks ?? []).map(r => r.subproject_id as number)
  if (subIds.length === 0) return { rows: [], total: null, error: null, note }

  // Widen to every sibling under the same IN4 project, so a group project
  // shows the whole family rather than only the one row it is linked to.
  const { data: seed } = await supabase.from('in4_subprojects').select('project_id').in('id', subIds).limit(1)
  const in4ProjectId = seed?.[0]?.project_id as number | undefined

  const { data: subs, error: sErr } = in4ProjectId != null
    ? await supabase.from('in4_subprojects')
        .select('id, name, construction_area_ft, budget').eq('project_id', in4ProjectId)
    : await supabase.from('in4_subprojects')
        .select('id, name, construction_area_ft, budget').in('id', subIds)
  if (sErr) return { rows: [], total: null, error: sErr.message, note }

  const ids = (subs ?? []).map(s => s.id as number)
  if (ids.length === 0) return { rows: [], total: null, error: null, note }

  const [woRes, certRes] = await Promise.all([
    supabase.from('in4_work_orders').select('subproject_id, wo_value').in('subproject_id', ids),
    supabase.from('in4_wo_certificates').select('subproject_id, certified_amt').in('subproject_id', ids),
  ])
  const err = woRes.error ?? certRes.error
  if (err) return { rows: [], total: null, error: err.message, note }

  const woBy = new Map<number, number>()
  for (const w of (woRes.data ?? []) as Array<{ subproject_id: number; wo_value: number | null }>) {
    woBy.set(w.subproject_id, (woBy.get(w.subproject_id) ?? 0) + Number(w.wo_value ?? 0))
  }
  const certBy = new Map<number, number>()
  for (const c of (certRes.data ?? []) as Array<{ subproject_id: number; certified_amt: number | null }>) {
    certBy.set(c.subproject_id, (certBy.get(c.subproject_id) ?? 0) + Number(c.certified_amt ?? 0))
  }

  const rows: CtWiseRow[] = (subs ?? []).map(s => {
    const id = s.id as number
    const budget = s.budget != null ? Number(s.budget) : null
    const wo = woBy.get(id) ?? null
    const certified = certBy.get(id) ?? null
    return {
      subprojectId: id,
      name: s.name as string,
      areaSft: s.construction_area_ft != null ? Math.round(Number(s.construction_area_ft)) : null,
      budgetErp: budget,
      woApproved: wo,
      uncommitted: budget == null ? null : budget - (wo ?? 0),
      certified,
      pctUsed: budget && budget !== 0 && certified != null ? Math.round((certified / budget) * 100) : null,
    }
  }).sort((a, b) => (b.budgetErp ?? 0) - (a.budgetErp ?? 0))

  const sum = (pick: (r: CtWiseRow) => number | null) =>
    rows.reduce<number | null>((acc, r) => (pick(r) == null && acc == null ? null : (acc ?? 0) + (pick(r) ?? 0)), null)
  const tBudget = sum(r => r.budgetErp)
  const tCert = sum(r => r.certified)

  return {
    rows,
    total: {
      subprojectId: -1, name: 'Total',
      areaSft: sum(r => r.areaSft),
      budgetErp: tBudget,
      woApproved: sum(r => r.woApproved),
      uncommitted: sum(r => r.uncommitted),
      certified: tCert,
      pctUsed: tBudget && tBudget !== 0 && tCert != null ? Math.round((tCert / tBudget) * 100) : null,
    },
    error: null,
    note,
  }
}
