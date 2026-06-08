'use server'
// Pull budget data from the IN4 BPH report (Budget Performance Hub) that
// Aksha uploads to /budget every week. That data lives in the
// budget_hub_state.state JSONB as { projects: [{ id, name, data: { rows: [...] } }] }.
//
// The first time a PM commits a pull for a (BPH, CT Hub) pair, we save
// the mapping in cc_bph_project_links. From then on, every save to
// /api/budget-hub/state auto-runs the pull for every mapped pair —
// no more weekly clicks.
//
// One-to-one constraint per side: a BPH project can map to at most one
// CT Hub project, and vice versa. Manage from /cost-control/import/bph.

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser } from '@/lib/auth'

const previewSchema = z.object({
  bph_project_id: z.string(),
  cc_project_id: z.string().uuid(),
})

const commitSchema = previewSchema.extend({
  row_keys: z.array(z.string()).optional(), // when provided, only commit these rows; otherwise commit all matched
})

// ─── Read-only listing of BPH projects ────────────────────────────────
interface BphRow {
  head: string
  budget: number
  actual: number
  woApproved: number
  catNum: string | number | null
  subNum?: string | number | null
}

interface BphProject {
  id: string
  name: string
  location?: string | null
  parentId?: string | null
  type?: string | null
  data?: { rows?: BphRow[] } | null
}

interface BphState {
  projects?: BphProject[]
}

export interface BphProjectSummary {
  id: string
  name: string
  location: string | null
  row_count: number
  total_budget: number
  total_actual: number
}

export interface BphMatchedRow {
  /** Stable key for the row — used when user selectively unticks rows. */
  key: string
  head: string
  catNum: string
  subNum: string | null
  budget: number
  actual: number
  woApproved: number
  matched_discipline_id: string | null
  matched_discipline_label: string | null
  matched_sub_skill_id: string | null
  matched_sub_skill_label: string | null
  /** Whether we can upsert (needs at least a discipline match). */
  importable: boolean
}

export type BphPreview =
  | { ok: true
      bph_project_name: string
      cc_project_label: string
      rows: BphMatchedRow[]
      stats: {
        total_rows: number
        importable_rows: number
        unmatched_rows: number
        total_budget: number
      } }
  | { ok: false; error: string }

export async function listBphProjects(): Promise<{ ok: true; projects: BphProjectSummary[] } | { ok: false; error: string }> {
  await requirePermission('cost-control', 'edit')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('budget_hub_state')
    .select('state')
    .eq('id', 'global')
    .single()
  if (error) return { ok: false, error: error.message }

  const state = (data?.state ?? {}) as BphState
  const projects: BphProjectSummary[] = (state.projects ?? [])
    .filter(p => p.data?.rows && p.data.rows.length > 0)
    .map(p => {
      const rows = p.data?.rows ?? []
      return {
        id: p.id,
        name: p.name,
        location: p.location ?? null,
        row_count: rows.length,
        total_budget: rows.reduce((s, r) => s + (Number(r.budget) || 0), 0),
        total_actual: rows.reduce((s, r) => s + (Number(r.actual) || 0), 0),
      }
    })
    .sort((a, b) => b.total_budget - a.total_budget)
  return { ok: true, projects }
}

export async function previewBphImport(input: z.infer<typeof previewSchema>): Promise<BphPreview> {
  await requirePermission('cost-control', 'edit')
  const parsed = previewSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = await createClient()
  const [{ data: stateRow }, { data: ccProject }, { data: disciplines }, { data: subSkills }] = await Promise.all([
    supabase.from('budget_hub_state').select('state').eq('id', 'global').single(),
    supabase.from('projects').select('id, code, name').eq('id', parsed.data.cc_project_id).single(),
    supabase.from('cc_disciplines').select('id, code, name').eq('is_archived', false),
    supabase.from('cc_sub_skills').select('id, code, name, discipline_id').eq('is_archived', false),
  ])

  const state = (stateRow?.state ?? {}) as BphState
  const bph = (state.projects ?? []).find(p => p.id === parsed.data.bph_project_id)
  if (!bph) return { ok: false, error: 'BPH project not found in /budget' }
  if (!ccProject) return { ok: false, error: 'CT Hub project not found' }

  // Lookup maps keyed by code (always stringify to compare cleanly with
  // BPH's catNum which may be number-or-string).
  const discByCode = new Map((disciplines ?? []).map(d => [String(d.code), d]))
  const subByCompositeCode = new Map(
    (subSkills ?? []).map(s => [`${s.discipline_id}::${String(s.code)}`, s]),
  )

  const rawRows = bph.data?.rows ?? []
  const matched: BphMatchedRow[] = rawRows.map((r, i) => {
    const catNumStr = r.catNum == null ? '' : String(r.catNum).trim()
    const subNumStr = r.subNum == null ? '' : String(r.subNum).trim()
    const disc = catNumStr ? discByCode.get(catNumStr) : null
    const sub = (disc && subNumStr) ? subByCompositeCode.get(`${disc.id}::${subNumStr}`) : null
    return {
      key: `${i}-${catNumStr || 'x'}-${subNumStr || 'x'}`,
      head: r.head,
      catNum: catNumStr,
      subNum: subNumStr || null,
      budget: Number(r.budget) || 0,
      actual: Number(r.actual) || 0,
      woApproved: Number(r.woApproved) || 0,
      matched_discipline_id: disc?.id ?? null,
      matched_discipline_label: disc ? `${disc.code} ${disc.name}` : null,
      matched_sub_skill_id: sub?.id ?? null,
      matched_sub_skill_label: sub ? `${sub.code} ${sub.name}` : null,
      // We need at least a discipline match. Sub-skill is optional — when
      // missing we'll upsert into the discipline-level rollup row.
      importable: !!disc,
    }
  })

  return {
    ok: true,
    bph_project_name: bph.name,
    cc_project_label: `${ccProject.code} — ${ccProject.name}`,
    rows: matched,
    stats: {
      total_rows: matched.length,
      importable_rows: matched.filter(r => r.importable).length,
      unmatched_rows: matched.filter(r => !r.importable).length,
      total_budget: matched.filter(r => r.importable).reduce((s, r) => s + r.budget, 0),
    },
  }
}

export interface CommitOutcome {
  ok: true
  inserted: number
  updated: number
  skipped: number
  errors: string[]
}

export async function commitBphImport(input: z.infer<typeof commitSchema>): Promise<CommitOutcome | { ok: false; error: string }> {
  await requirePermission('cost-control', 'edit')
  const parsed = commitSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const preview = await previewBphImport({
    bph_project_id: parsed.data.bph_project_id,
    cc_project_id: parsed.data.cc_project_id,
  })
  if (!preview.ok) return preview

  const wanted = parsed.data.row_keys ? new Set(parsed.data.row_keys) : null
  const toImport = preview.rows.filter(r => r.importable && (!wanted || wanted.has(r.key)))

  const supabase = await createClient()
  let inserted = 0, updated = 0, skipped = 0
  const errors: string[] = []

  for (const r of toImport) {
    const sub_skill_id = r.matched_sub_skill_id // may be null

    // Look up existing budget line for this (project, discipline, sub_skill, line_type='work').
    // BPH doesn't split work/material so we pick a single canonical bucket: 'work'.
    const baseQ = supabase
      .from('cc_budget_lines')
      .select('id, current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', parsed.data.cc_project_id)
      .eq('discipline_id', r.matched_discipline_id!)
      .eq('line_type', 'work')
    const { data: existing } = await (sub_skill_id === null
      ? baseQ.is('sub_skill_id', null)
      : baseQ.eq('sub_skill_id', sub_skill_id)
    ).maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('cc_budget_lines')
        .update({
          current_budget_amt: r.budget,
          current_wo_committed_amt: r.woApproved,
          current_paid_amt: r.actual,
        })
        .eq('id', existing.id)
      if (error) { errors.push(`${r.head}: ${error.message}`); skipped++ }
      else { updated++ }
    } else {
      const { data: newLine, error } = await supabase
        .from('cc_budget_lines')
        .insert({
          project_id: parsed.data.cc_project_id,
          discipline_id: r.matched_discipline_id,
          sub_skill_id,
          line_type: 'work',
          current_budget_amt: r.budget,
          current_wo_committed_amt: r.woApproved,
          current_paid_amt: r.actual,
          notes: `From BPH report · ${r.head}`,
        })
        .select('id')
        .single()
      if (error) { errors.push(`${r.head}: ${error.message}`); skipped++ }
      else {
        inserted++
        if (r.budget > 0 && newLine) {
          // Emit a budget_add event so reconciliation works the same as
          // the Excel-import path.
          await supabase.from('cc_budget_events').insert({
            budget_line_id: newLine.id,
            project_id: parsed.data.cc_project_id,
            event_type: 'budget_add',
            delta_amount: r.budget,
            remarks: `BPH pull · ${r.head}`.slice(0, 500),
          })
        }
      }
    }
  }

  // Persist the BPH↔CT mapping so future BPH saves auto-pull. Upsert keyed
  // on bph_project_id (the BPH side); if the same BPH project is being
  // remapped to a different CT project (rare — usually a fix), update.
  const me = await getMyUser()
  await supabase
    .from('cc_bph_project_links')
    .upsert({
      bph_project_id: parsed.data.bph_project_id,
      cc_project_id: parsed.data.cc_project_id,
      created_by: me?.id ?? null,
      last_pulled_at: new Date().toISOString(),
      last_pull_result: { inserted, updated, skipped, errors_count: errors.length },
    }, { onConflict: 'bph_project_id' })

  revalidatePath(`/cost-control/projects/${parsed.data.cc_project_id}`)
  revalidatePath('/cost-control')
  revalidatePath('/cost-control/import')
  revalidatePath('/cost-control/import/bph')

  return { ok: true, inserted, updated, skipped, errors }
}

// ────────────────────────────────────────────────────────────────────
// Auto-pull on every BPH save. Called from /api/budget-hub/state PUT
// AND from a manual "Sync all mapped" button on /cost-control/import/bph.
// Returns a per-project outcome so the caller can render a freshness chip.
// ────────────────────────────────────────────────────────────────────

export interface MappedPullOutcome {
  bph_project_id: string
  cc_project_id: string
  ok: boolean
  inserted?: number
  updated?: number
  skipped?: number
  error?: string
}

export async function runAllMappedPulls(): Promise<{ ok: true; outcomes: MappedPullOutcome[]; ran_at: string }> {
  // Best-effort: each pull catches its own error so one bad mapping
  // doesn't take down the whole sync. Permission is intentionally relaxed
  // here because this is also called from the /budget save hook by any
  // signed-in user — the underlying writes still go through Supabase RLS.
  const supabase = await createClient()
  const { data: links } = await supabase
    .from('cc_bph_project_links')
    .select('bph_project_id, cc_project_id')
  const ranAt = new Date().toISOString()
  const outcomes: MappedPullOutcome[] = []
  for (const link of links ?? []) {
    try {
      const r = await commitBphImport({
        bph_project_id: link.bph_project_id,
        cc_project_id: link.cc_project_id,
      })
      if (r.ok) {
        outcomes.push({
          bph_project_id: link.bph_project_id,
          cc_project_id: link.cc_project_id,
          ok: true,
          inserted: r.inserted,
          updated: r.updated,
          skipped: r.skipped,
        })
      } else {
        outcomes.push({
          bph_project_id: link.bph_project_id,
          cc_project_id: link.cc_project_id,
          ok: false,
          error: r.error,
        })
      }
    } catch (err) {
      outcomes.push({
        bph_project_id: link.bph_project_id,
        cc_project_id: link.cc_project_id,
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }
  return { ok: true, outcomes, ran_at: ranAt }
}

// Lightweight read for the freshness chip on the dashboard.
export async function getLastBphSync(): Promise<{
  ran_at: string | null
  total_links: number
  ok_count: number
  err_count: number
}> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('cc_bph_project_links')
    .select('last_pulled_at, last_pull_result')
  const links = data ?? []
  let mostRecent: string | null = null
  let okCount = 0
  let errCount = 0
  for (const l of links) {
    if (l.last_pulled_at && (!mostRecent || l.last_pulled_at > mostRecent)) mostRecent = l.last_pulled_at
    const r = (l.last_pull_result as { errors_count?: number } | null)
    if (r && (r.errors_count ?? 0) > 0) errCount++
    else if (l.last_pulled_at) okCount++
  }
  return { ran_at: mostRecent, total_links: links.length, ok_count: okCount, err_count: errCount }
}

export async function listMappings(): Promise<Array<{
  bph_project_id: string
  cc_project_id: string
  last_pulled_at: string | null
}>> {
  await requirePermission('cost-control', 'view')
  const supabase = await createClient()
  const { data } = await supabase
    .from('cc_bph_project_links')
    .select('bph_project_id, cc_project_id, last_pulled_at')
    .order('last_pulled_at', { ascending: false, nullsFirst: false })
  return (data ?? []).map(r => ({
    bph_project_id: r.bph_project_id as string,
    cc_project_id: r.cc_project_id as string,
    last_pulled_at: r.last_pulled_at as string | null,
  }))
}

export async function unlinkBphMapping(bph_project_id: string): Promise<{ ok: boolean; error?: string }> {
  await requirePermission('cost-control', 'edit')
  const supabase = await createClient()
  const { error } = await supabase.from('cc_bph_project_links').delete().eq('bph_project_id', bph_project_id)
  if (error) return { ok: false, error: error.message }
  revalidatePath('/cost-control/import/bph')
  return { ok: true }
}
