'use server'
// Copy a project's setup onto another project — the disciplines/sub-skills
// tick-work (2,000+ rows across the portfolio) and, optionally, the approver
// chain. Setting one project up and reusing it is what Aksha asked for.
//
// ADDITIVE, never destructive: it turns things ON that the source has and the
// target lacks. It never disables anything already ticked on the target, and it
// never touches money, working sheets, completion marks or ERP reductions.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'
import { checkIsCcReviewer } from '@/components/cost-control/ws-actions'

export interface CopySetupInput {
  sourceProjectId: string
  targetProjectId: string
  includeDisciplines: boolean
  includeApprovers: boolean
}

export interface CopySetupSummary {
  disciplinesAdded: number
  subSkillsAdded: number
  approversAdded: number
  alreadyThere: number
}

export type CopySetupResult =
  | { ok: true; summary: CopySetupSummary }
  | { ok: false; error: string }

/** Same gate as the Setup screen itself: cost-control edit AND a reviewer
 *  (management) — engineers hold cost-control edit for their own sheets only. */
async function gate(): Promise<string | null> {
  await requirePermission('cost-control', 'edit')
  if (!(await checkIsCcReviewer())) {
    return 'Only management can copy a project setup.'
  }
  return null
}

export async function copyProjectSetup(input: CopySetupInput): Promise<CopySetupResult> {
  const denied = await gate()
  if (denied) return { ok: false, error: denied }

  const { sourceProjectId, targetProjectId, includeDisciplines, includeApprovers } = input
  if (!sourceProjectId || !targetProjectId) return { ok: false, error: 'Pick a project to copy from.' }
  if (sourceProjectId === targetProjectId) return { ok: false, error: 'That is the same project.' }
  if (!includeDisciplines && !includeApprovers) return { ok: false, error: 'Pick at least one thing to copy.' }

  const supabase = await createClient()
  const me = await getMyUser()
  const summary: CopySetupSummary = {
    disciplinesAdded: 0, subSkillsAdded: 0, approversAdded: 0, alreadyThere: 0,
  }

  if (includeDisciplines) {
    const [srcDisc, srcSubs, tgtDisc, tgtSubs] = await Promise.all([
      supabase.from('cc_project_disciplines')
        .select('discipline_id, estimation_mode, thumbrule_rate_per_sft, thumbrule_notes')
        .eq('project_id', sourceProjectId).eq('is_enabled', true),
      supabase.from('cc_project_sub_skills')
        .select('sub_skill_id, estimation_mode, thumbrule_rate_per_sft, thumbrule_notes')
        .eq('project_id', sourceProjectId).eq('is_enabled', true),
      supabase.from('cc_project_disciplines').select('discipline_id').eq('project_id', targetProjectId).eq('is_enabled', true),
      supabase.from('cc_project_sub_skills').select('sub_skill_id').eq('project_id', targetProjectId).eq('is_enabled', true),
    ])
    const firstErr = srcDisc.error ?? srcSubs.error ?? tgtDisc.error ?? tgtSubs.error
    if (firstErr) return { ok: false, error: firstErr.message }

    const haveDisc = new Set((tgtDisc.data ?? []).map(r => r.discipline_id as string))
    const haveSubs = new Set((tgtSubs.data ?? []).map(r => r.sub_skill_id as string))

    const discRows = (srcDisc.data ?? [])
      .filter(r => !haveDisc.has(r.discipline_id as string))
      .map(r => ({
        project_id: targetProjectId,
        discipline_id: r.discipline_id as string,
        is_enabled: true,
        enabled_by: me?.id ?? null,
        estimation_mode: r.estimation_mode as string | null,
        thumbrule_rate_per_sft: r.thumbrule_rate_per_sft as number | null,
        thumbrule_notes: r.thumbrule_notes as string | null,
      }))
    const subRows = (srcSubs.data ?? [])
      .filter(r => !haveSubs.has(r.sub_skill_id as string))
      .map(r => ({
        project_id: targetProjectId,
        sub_skill_id: r.sub_skill_id as string,
        is_enabled: true,
        enabled_by: me?.id ?? null,
        estimation_mode: r.estimation_mode as string | null,
        thumbrule_rate_per_sft: r.thumbrule_rate_per_sft as number | null,
        thumbrule_notes: r.thumbrule_notes as string | null,
      }))

    summary.alreadyThere +=
      ((srcDisc.data ?? []).length - discRows.length) + ((srcSubs.data ?? []).length - subRows.length)

    if (discRows.length > 0) {
      const { error } = await supabase.from('cc_project_disciplines')
        .upsert(discRows, { onConflict: 'project_id,discipline_id' })
      if (error) return { ok: false, error: `Work categories: ${error.message}` }
      summary.disciplinesAdded = discRows.length
    }
    if (subRows.length > 0) {
      const { error } = await supabase.from('cc_project_sub_skills')
        .upsert(subRows, { onConflict: 'project_id,sub_skill_id' })
      if (error) return { ok: false, error: `Sub-skills: ${error.message}` }
      summary.subSkillsAdded = subRows.length
    }
  }

  if (includeApprovers) {
    const [src, tgt] = await Promise.all([
      supabase.from('cc_project_approvers').select('role, user_id').eq('project_id', sourceProjectId),
      supabase.from('cc_project_approvers').select('role, user_id').eq('project_id', targetProjectId),
    ])
    if (src.error ?? tgt.error) return { ok: false, error: (src.error ?? tgt.error)!.message }

    const have = new Set((tgt.data ?? []).map(r => `${r.role}::${r.user_id}`))
    const rows = (src.data ?? [])
      .filter(r => !have.has(`${r.role}::${r.user_id}`))
      .map(r => ({
        project_id: targetProjectId,
        role: r.role as string,
        user_id: r.user_id as string,
        assigned_by: me?.id ?? null,
      }))
    summary.alreadyThere += (src.data ?? []).length - rows.length

    if (rows.length > 0) {
      const { error } = await supabase.from('cc_project_approvers')
        .upsert(rows, { onConflict: 'project_id,role,user_id' })
      if (error) return { ok: false, error: `Approvers: ${error.message}` }
      summary.approversAdded = rows.length
    }
  }

  revalidatePath(`/cost-control/projects/${targetProjectId}`)
  revalidatePath(`/cost-control/projects/${targetProjectId}/setup`)
  return { ok: true, summary }
}

export interface SetupSourceOption {
  id: string
  label: string
  disciplines: number
  subSkills: number
  approvers: number
}

/** Projects worth copying FROM — ones that actually have a setup, richest
 *  first, so the picker suggests a good template rather than an empty shell. */
export async function listSetupSources(excludeProjectId: string): Promise<SetupSourceOption[]> {
  const denied = await gate()
  if (denied) return []

  const supabase = await createClient()
  const [projRes, discRes, subRes, apprRes] = await Promise.all([
    supabase.from('projects').select('id, code, name').is('archived_at', null).order('code'),
    supabase.from('cc_project_disciplines').select('project_id').eq('is_enabled', true),
    supabase.from('cc_project_sub_skills').select('project_id').eq('is_enabled', true),
    supabase.from('cc_project_approvers').select('project_id'),
  ])

  const tally = (rows: Array<{ project_id: string }> | null) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(r.project_id, (m.get(r.project_id) ?? 0) + 1)
    return m
  }
  const dMap = tally(discRes.data as Array<{ project_id: string }> | null)
  const sMap = tally(subRes.data as Array<{ project_id: string }> | null)
  const aMap = tally(apprRes.data as Array<{ project_id: string }> | null)

  return ((projRes.data ?? []) as Array<{ id: string; code: string | null; name: string }>)
    .filter(p => p.id !== excludeProjectId)
    .map(p => ({
      id: p.id,
      label: `${p.code ? `${p.code} · ` : ''}${p.name}`,
      disciplines: dMap.get(p.id) ?? 0,
      subSkills: sMap.get(p.id) ?? 0,
      approvers: aMap.get(p.id) ?? 0,
    }))
    .filter(p => p.disciplines > 0 || p.approvers > 0)
    .sort((a, b) => (b.subSkills + b.disciplines) - (a.subSkills + a.disciplines))
}
