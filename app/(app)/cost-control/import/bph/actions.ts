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
import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser, getMyPermissions, can } from '@/lib/auth'

// The unattended paths (the twice-daily cron) pass a service-role client +
// actorId so the same pull logic runs with no user session (skipping the
// per-request auth gates). Typed back to the server-client shape so the
// queries below stay type-checked.
type CcClient = Awaited<ReturnType<typeof createClient>>
interface ServiceOpts { client?: SupabaseClient; actorId?: string | null }
import { generateJSON, hasAiProvider } from '@/lib/ai'
import { formatINR } from '@/lib/utils'

const previewSchema = z.object({
  bph_project_id: z.string(),
  cc_project_id: z.string().uuid(),
})

// A row exactly as the client previewed it. Commit writes THESE — it never
// re-runs the matcher, so what the PM previewed is what lands. (head is
// carried along for notes / audit remarks.)
const commitRowSchema = z.object({
  key: z.string(),
  head: z.string(),
  discipline_id: z.string().uuid(),
  sub_skill_id: z.string().uuid().nullable(),
  budget: z.number().finite(),
  woApproved: z.number().finite(),
  actual: z.number().finite(),
  will_enable_discipline: z.boolean(),
  will_enable_sub_skill: z.boolean(),
})

const commitSchema = previewSchema.extend({
  // When provided (the interactive import screen), commit these exact
  // previewed rows. When absent (auto-pull / Sync now / project re-sync),
  // a fresh code-match runs server-side.
  rows: z.array(commitRowSchema).optional(),
  // ALL importable lines the preview saw in the report — ticked or not.
  // Stale-line zeroing must compare against what's IN THE REPORT, not what
  // the PM selected; otherwise unticking a row zeroes a live budget line.
  present_lines: z.array(z.object({
    discipline_id: z.string().uuid(),
    sub_skill_id: z.string().uuid().nullable(),
  })).optional(),
  // Money-carrying rows the preview could NOT place. When > 0 we skip
  // stale-line zeroing for safety — one of them could be a previously
  // pulled line whose code mapping broke.
  unmatched_count: z.number().int().min(0).optional(),
})

type CommitRow = z.infer<typeof commitRowSchema>

// Stable identity of a budget line within a project for last_pull tracking.
function lineKey(discipline_id: string, sub_skill_id: string | null): string {
  return `${discipline_id}::${sub_skill_id ?? ''}`
}

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
  // `rows` = discipline rollup (one per catNum). `subRows` = the real
  // sub-skill detail (catNum + subNum). The BPH hub computes both: rows
  // is the byCat summary, subRows is the bySub breakdown. We prefer
  // subRows so Cost Control gets per-sub-skill budget/actuals.
  data?: { rows?: BphRow[]; subRows?: BphRow[] } | null
}

interface BphState {
  projects?: BphProject[]
}

// Normalise a category / sub-skill code for matching. Hand-typed BPH
// sheets pad codes inconsistently (01 vs 001 vs 0001); CT Hub stores a
// clean "01". For all-digit codes we strip leading zeros so they compare
// numerically (001 → "1", 01 → "1", 10 → "10"). Codes with letters
// (e.g. "02E") just get trimmed + uppercased.
function normCode(s: string | number | null | undefined): string {
  const t = String(s ?? '').trim()
  if (!t) return ''
  if (/^\d+$/.test(t)) return String(parseInt(t, 10))
  return t.toUpperCase()
}

// Build the canonical row set to import from a BPH project:
//   - Every subRow (catNum + subNum) becomes a sub-skill budget line.
//   - For any catNum that has NO subRows, fall back to its discipline
//     rollup row (catNum only) so disciplines reported only at summary
//     level still come through.
// This avoids double-counting (a discipline + its own sub-detail) at the
// source while giving the finest granularity BPH actually provides.
function bphSourceRows(bph: BphProject): BphRow[] {
  const subRows = bph.data?.subRows ?? []
  const catRows = bph.data?.rows ?? []
  // Compare NORMALISED cat codes on both sides — sheets pad inconsistently
  // ('001' on the cat rollup vs '01' on its sub rows), and a raw-string
  // comparison let both through, double-counting that discipline in the
  // preview total.
  const catsWithSub = new Set(subRows.map(r => normCode(r.catNum)).filter(Boolean))
  const catOnly = catRows.filter(c => {
    const cat = normCode(c.catNum)
    return cat && !catsWithSub.has(cat)
  })
  return [...subRows, ...catOnly]
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
  /** How the match was made: 'code' (exact/normalised code), 'ai' (name
   *  similarity fallback), or null (unmatched). */
  match_source: 'code' | 'ai' | null
  /** AI confidence 0..1 when match_source==='ai'. */
  ai_confidence: number | null
  /** True when the matched discipline isn't enabled in the project's setup
   *  yet — importing will auto-enable it. Surfaced in the preview so the
   *  PM knows a forgotten discipline is being added. */
  will_enable_discipline: boolean
  will_enable_sub_skill: boolean
  /** True when the row carries any money (budget / WO / actual ≠ 0).
   *  Zero-everywhere rows are skipped — no point enabling a sub-skill or
   *  writing an all-zero budget line. */
  has_data: boolean
  /** Whether we can upsert (needs a discipline match AND some data). */
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
        ai_matched_rows: number
        will_enable_count: number
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
    .map(p => {
      // Count + total the canonical source rows (subRows preferred), so
      // the picker shows the granular row count + true budget.
      const rows = bphSourceRows(p)
      return {
        id: p.id,
        name: p.name,
        location: p.location ?? null,
        row_count: rows.length,
        total_budget: rows.reduce((s, r) => s + (Number(r.budget) || 0), 0),
        total_actual: rows.reduce((s, r) => s + (Number(r.actual) || 0), 0),
      }
    })
    .filter(p => p.row_count > 0)
    .sort((a, b) => b.total_budget - a.total_budget)
  return { ok: true, projects }
}

export async function previewBphImport(
  input: z.infer<typeof previewSchema>,
  // useAi:false = code matches only. The unsupervised auto-pull uses it so
  // AI never guesses a mapping without a human looking at the preview.
  opts?: { useAi?: boolean } & ServiceOpts,
): Promise<BphPreview> {
  if (!opts?.client) await requirePermission('cost-control', 'edit')
  const parsed = previewSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = (opts?.client ?? await createClient()) as CcClient
  const [{ data: stateRow }, { data: ccProject }, { data: disciplines }, { data: subSkills }, { data: enDisc }, { data: enSub }] = await Promise.all([
    supabase.from('budget_hub_state').select('state').eq('id', 'global').single(),
    supabase.from('projects').select('id, code, name').eq('id', parsed.data.cc_project_id).single(),
    supabase.from('cc_disciplines').select('id, code, name').eq('is_archived', false),
    supabase.from('cc_sub_skills').select('id, code, name, discipline_id').eq('is_archived', false),
    // Currently-enabled disciplines / sub-skills for THIS project — used
    // to flag rows whose discipline/sub-skill the import will auto-enable.
    supabase.from('cc_project_disciplines').select('discipline_id').eq('project_id', parsed.data.cc_project_id).eq('is_enabled', true),
    supabase.from('cc_project_sub_skills').select('sub_skill_id').eq('project_id', parsed.data.cc_project_id).eq('is_enabled', true),
  ])

  const state = (stateRow?.state ?? {}) as BphState
  const bph = (state.projects ?? []).find(p => p.id === parsed.data.bph_project_id)
  if (!bph) return { ok: false, error: 'BPH project not found in /budget' }
  if (!ccProject) return { ok: false, error: 'CT Hub project not found' }

  const enabledDiscIds = new Set((enDisc ?? []).map(d => d.discipline_id as string))
  const enabledSubIds  = new Set((enSub ?? []).map(s => s.sub_skill_id as string))

  // Lookup maps keyed by NORMALISED code. BPH sheets are hand-typed and
  // codes drift in format — the same discipline shows up as "01", "001",
  // and "0001" across rows, while CT Hub stores a clean "01". normCode
  // strips leading zeros from all-digit codes so 001 / 0001 / 01 all
  // collapse to the same key. Non-numeric codes (e.g. "02E") fall back to
  // trimmed-uppercase.
  const discByCode = new Map((disciplines ?? []).map(d => [normCode(d.code), d]))
  const subByCompositeCode = new Map(
    (subSkills ?? []).map(s => [`${s.discipline_id}::${normCode(s.code)}`, s]),
  )
  const discById = new Map((disciplines ?? []).map(d => [d.id, d]))
  const subById  = new Map((subSkills ?? []).map(s => [s.id, s]))

  const rawRows = bphSourceRows(bph)
  const matched: BphMatchedRow[] = rawRows.map((r, i) => {
    const catNumStr = r.catNum == null ? '' : String(r.catNum).trim()
    const subNumStr = r.subNum == null ? '' : String(r.subNum).trim()
    const disc = catNumStr ? discByCode.get(normCode(catNumStr)) : null
    const sub = (disc && subNumStr) ? subByCompositeCode.get(`${disc.id}::${normCode(subNumStr)}`) : null
    const budget = Number(r.budget) || 0
    const actual = Number(r.actual) || 0
    const woApproved = Number(r.woApproved) || 0
    const hasData = budget !== 0 || actual !== 0 || woApproved !== 0
    return {
      key: `${i}-${catNumStr || 'x'}-${subNumStr || 'x'}`,
      head: r.head,
      catNum: catNumStr,
      subNum: subNumStr || null,
      budget,
      actual,
      woApproved,
      matched_discipline_id: disc?.id ?? null,
      matched_discipline_label: disc ? `${disc.code} ${disc.name}` : null,
      matched_sub_skill_id: sub?.id ?? null,
      matched_sub_skill_label: sub ? `${sub.code} ${sub.name}` : null,
      match_source: disc ? 'code' : null,
      ai_confidence: null,
      will_enable_discipline: !!disc && hasData && !enabledDiscIds.has(disc.id),
      will_enable_sub_skill: !!sub && hasData && !enabledSubIds.has(sub.id),
      has_data: hasData,
      // Importable = matched to a discipline AND carries money. Zero-
      // everywhere rows are dropped so they don't enable empty sub-skills
      // or write all-zero budget lines.
      importable: !!disc && hasData,
    }
  })

  // ── AI fallback (second layer) ──────────────────────────────────────
  // For rows the code matcher couldn't place, ask the AI to match the BPH
  // "head" text to a discipline (and sub-skill) by NAME similarity. This
  // catches cases where the code is wrong/missing but the name is clear
  // (e.g. head "Plumbing Works" with a junk cat code). Only runs when an
  // AI provider is configured and there ARE unmatched rows — keeps it
  // free-tier-friendly.
  // Only AI-match rows that have data but no code match — no point
  // resolving a zero-everywhere row.
  const unmatched = matched.filter(m => !m.importable && m.has_data && m.head?.trim())
  if (unmatched.length > 0 && (opts?.useAi ?? true) && hasAiProvider()) {
    try {
      const catalogue = {
        disciplines: (disciplines ?? []).map(d => ({ id: d.id, code: d.code, name: d.name })),
        sub_skills: (subSkills ?? []).map(s => ({ id: s.id, code: s.code, name: s.name, discipline_id: s.discipline_id })),
      }
      const aiRes = await generateJSON<{ matches?: Array<{ key: string; discipline_id: string | null; sub_skill_id: string | null; confidence: number }> }>({
        system: `You match construction budget line headings to a catalogue of disciplines + sub-skills by NAME similarity. Indian construction (SRMD). For each input row, pick the best discipline_id from the catalogue (and sub_skill_id if one clearly fits under that discipline). Use null when there's no confident match — do NOT force a match. confidence is 0..1; only suggest discipline matches you'd be ≥0.6 sure of. Output STRICT JSON: {"matches":[{"key","discipline_id","sub_skill_id","confidence"}]}, one per input row.`,
        user: `Catalogue:\n${JSON.stringify(catalogue)}\n\nRows to match (by head text):\n${JSON.stringify(unmatched.map(u => ({ key: u.key, head: u.head, catNum: u.catNum, subNum: u.subNum })))}`,
        maxOutputTokens: 4000,
      })
      if (aiRes.ok) {
        const byKey = new Map((aiRes.data.matches ?? []).map(m => [m.key, m]))
        for (const row of matched) {
          if (row.importable) continue
          const sug = byKey.get(row.key)
          if (!sug || !sug.discipline_id || (sug.confidence ?? 0) < 0.6) continue
          const d = discById.get(sug.discipline_id)
          if (!d) continue
          // Only accept a sub-skill suggestion that genuinely sits under
          // the suggested discipline.
          const s = sug.sub_skill_id ? subById.get(sug.sub_skill_id) : null
          const sValid = s && s.discipline_id === d.id ? s : null
          row.matched_discipline_id = d.id
          row.matched_discipline_label = `${d.code} ${d.name}`
          row.matched_sub_skill_id = sValid?.id ?? null
          row.matched_sub_skill_label = sValid ? `${sValid.code} ${sValid.name}` : null
          row.match_source = 'ai'
          row.ai_confidence = Math.max(0, Math.min(1, sug.confidence ?? 0))
          row.will_enable_discipline = !enabledDiscIds.has(d.id)
          row.will_enable_sub_skill = !!sValid && !enabledSubIds.has(sValid.id)
          row.importable = true
        }
      }
    } catch {
      // AI is best-effort — code matches still stand if it fails.
    }
  }

  return {
    ok: true,
    bph_project_name: bph.name,
    cc_project_label: `${ccProject.code} — ${ccProject.name}`,
    rows: matched,
    stats: {
      total_rows: matched.filter(r => r.has_data).length,
      importable_rows: matched.filter(r => r.importable).length,
      // "unmatched" = rows that carry money but we couldn't place — the
      // real concern. Zero-everywhere rows aren't counted (we ignore them).
      unmatched_rows: matched.filter(r => r.has_data && !r.matched_discipline_id).length,
      ai_matched_rows: matched.filter(r => r.match_source === 'ai').length,
      will_enable_count: matched.filter(r => r.importable && (r.will_enable_discipline || r.will_enable_sub_skill)).length,
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

export async function commitBphImport(
  input: z.infer<typeof commitSchema>,
  opts?: { useAi?: boolean } & ServiceOpts,
): Promise<CommitOutcome | { ok: false; error: string }> {
  if (!opts?.client) await requirePermission('cost-control', 'edit')
  const parsed = commitSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid input' }

  const supabase = (opts?.client ?? await createClient()) as CcClient

  let toImport: CommitRow[]
  // Money-carrying rows we couldn't place. Only known when WE run the match
  // (the non-interactive paths); recorded in last_pull_result so the mapping
  // screen can show how many rows still need manual mapping.
  let unmatchedNames: string[] | null = null

  if (parsed.data.rows) {
    // Interactive commit: write EXACTLY the rows the PM previewed and kept
    // ticked — never re-run the matcher (a re-run could land different rows
    // than the ones shown). Validate the client-held ids + amounts against
    // the masters first.
    if (parsed.data.rows.length === 0) return { ok: false, error: 'No rows selected' }
    const rowDiscIds = Array.from(new Set(parsed.data.rows.map(r => r.discipline_id)))
    const rowSubIds  = Array.from(new Set(parsed.data.rows.map(r => r.sub_skill_id).filter((x): x is string => !!x)))
    const { data: validDisc, error: discErr } = await supabase
      .from('cc_disciplines')
      .select('id')
      .eq('is_archived', false)
      .in('id', rowDiscIds)
    if (discErr) return { ok: false, error: discErr.message }
    const validDiscIds = new Set((validDisc ?? []).map(d => d.id as string))
    const subDiscById = new Map<string, string>()
    if (rowSubIds.length > 0) {
      const { data: validSub, error: subErr } = await supabase
        .from('cc_sub_skills')
        .select('id, discipline_id')
        .eq('is_archived', false)
        .in('id', rowSubIds)
      if (subErr) return { ok: false, error: subErr.message }
      for (const s of validSub ?? []) subDiscById.set(s.id as string, s.discipline_id as string)
    }
    for (const r of parsed.data.rows) {
      if (!validDiscIds.has(r.discipline_id)) {
        return { ok: false, error: `"${r.head}": its matched discipline no longer exists — please preview again` }
      }
      if (r.sub_skill_id && subDiscById.get(r.sub_skill_id) !== r.discipline_id) {
        return { ok: false, error: `"${r.head}": its matched sub-skill doesn't sit under that discipline — please preview again` }
      }
    }
    // The amounts must be the REPORT's amounts, not whatever the client
    // posted — server actions are callable endpoints, and BPH figures are
    // the ERP source of truth. Re-derive the source rows and verify each
    // posted row by its preview key; any drift (tampering OR a report
    // re-uploaded since the preview) rejects with a re-preview prompt.
    const { data: stateRow, error: stateErr } = await supabase
      .from('budget_hub_state')
      .select('state')
      .eq('id', 'global')
      .single()
    if (stateErr) return { ok: false, error: stateErr.message }
    const bph = (((stateRow?.state ?? {}) as BphState).projects ?? []).find(p => p.id === parsed.data.bph_project_id)
    if (!bph) return { ok: false, error: 'BPH project not found in /budget — please preview again' }
    const srcByKey = new Map<string, BphRow>(bphSourceRows(bph).map((r, i) => {
      const catNumStr = r.catNum == null ? '' : String(r.catNum).trim()
      const subNumStr = r.subNum == null ? '' : String(r.subNum).trim()
      return [`${i}-${catNumStr || 'x'}-${subNumStr || 'x'}`, r] as [string, BphRow]
    }))
    for (const r of parsed.data.rows) {
      const src = srcByKey.get(r.key)
      const drift = !src
        || Math.abs((Number(src.budget) || 0) - r.budget) > 1
        || Math.abs((Number(src.woApproved) || 0) - r.woApproved) > 1
        || Math.abs((Number(src.actual) || 0) - r.actual) > 1
      if (drift) {
        return { ok: false, error: `"${r.head}": the BPH report has changed since this preview — please preview again` }
      }
    }
    toImport = parsed.data.rows
  } else {
    // Non-interactive (auto-pull on /budget save, Sync now, project-page
    // re-sync): run the matcher fresh. The unsupervised auto-pull passes
    // useAi:false so it only ever writes exact/normalised code matches.
    const preview = await previewBphImport(
      { bph_project_id: parsed.data.bph_project_id, cc_project_id: parsed.data.cc_project_id },
      { useAi: opts?.useAi ?? true, client: opts?.client },
    )
    if (!preview.ok) return preview
    toImport = preview.rows
      .filter(r => r.importable)
      .map(r => ({
        key: r.key,
        head: r.head,
        discipline_id: r.matched_discipline_id!,
        sub_skill_id: r.matched_sub_skill_id,
        budget: r.budget,
        woApproved: r.woApproved,
        actual: r.actual,
        will_enable_discipline: r.will_enable_discipline,
        will_enable_sub_skill: r.will_enable_sub_skill,
      }))
    unmatchedNames = preview.rows
      .filter(r => r.has_data && !r.matched_discipline_id)
      .map(r => r.head)
  }

  // Actor for audit columns — the signed-in user, or the cron's actorId (null).
  const me = opts?.client ? ({ id: opts.actorId ?? null } as { id: string | null }) : await getMyUser()

  // Keys this pull carries (attempted, not just succeeded — a transient
  // write error must not make the next pull think the line vanished and
  // zero it). Compared against the PREVIOUS pull's keys to find lines that
  // dropped out of the IN4 report.
  const pulledKeys = toImport.map(r => lineKey(r.discipline_id, r.sub_skill_id))
  // Keys PRESENT in the report this pull — the zeroing baseline. On the
  // interactive path this is every importable preview row (ticked or not:
  // unticking a row must never read as "vanished from IN4"); on the auto
  // path importable == present. Zeroing is skipped entirely when the
  // report still has unmatched money rows (one could be a previously
  // pulled line whose mapping broke) or when an older client didn't send
  // the present set.
  const presentKeys: string[] | null = parsed.data.rows
    ? (parsed.data.present_lines?.map(l => lineKey(l.discipline_id, l.sub_skill_id)) ?? null)
    : pulledKeys
  const unmatchedMoneyRows = parsed.data.rows
    ? (parsed.data.unmatched_count ?? 0)
    : (unmatchedNames?.length ?? 0)
  const canZeroStale = presentKeys !== null && unmatchedMoneyRows === 0
  // Read the previous pull's keys BEFORE we overwrite the link row. Guard on
  // cc_project_id so a remapped link never zeroes lines in a different
  // project.
  const { data: prevLink, error: prevLinkErr } = await supabase
    .from('cc_bph_project_links')
    .select('cc_project_id, last_pull')
    .eq('bph_project_id', parsed.data.bph_project_id)
    .maybeSingle()
  const prevKeys: string[] =
    !prevLinkErr && prevLink && prevLink.cc_project_id === parsed.data.cc_project_id
      ? ((prevLink.last_pull as { keys?: string[] } | null)?.keys ?? [])
      : []

  let inserted = 0, updated = 0, skipped = 0
  const errors: string[] = []
  if (prevLinkErr) errors.push(`Couldn't read the previous pull's bookkeeping — removed-line cleanup skipped this time (${prevLinkErr.message})`)
  // Disciplines that received a sub-skill line in this import — their old
  // discipline-root (sub_skill_id NULL) summary line, if any, is now
  // redundant and must be removed so it doesn't linger as stale data.
  const discWithSubLines = new Set<string>()

  // Auto-enable the disciplines + sub-skills that appear in this BPH pull.
  // If IN4 reports budget/actuals against a sub-skill, the project clearly
  // uses it — so it must be enabled, or its budget line would be invisible
  // on the detail page AND excluded from the discipline rollup (which only
  // sums ENABLED sub-skills). We only INSERT missing rows; we never touch
  // existing config (estimation_mode, thumbrule rate, etc.).
  const neededDiscIds = Array.from(new Set(toImport.map(r => r.discipline_id)))
  const neededSubIds  = Array.from(new Set(toImport.map(r => r.sub_skill_id).filter((x): x is string => !!x)))

  if (neededDiscIds.length > 0) {
    const { data: existingDisc } = await supabase
      .from('cc_project_disciplines')
      .select('discipline_id')
      .eq('project_id', parsed.data.cc_project_id)
      .in('discipline_id', neededDiscIds)
    const haveDisc = new Set((existingDisc ?? []).map(d => d.discipline_id as string))
    const missingDisc = neededDiscIds.filter(id => !haveDisc.has(id))
    if (missingDisc.length > 0) {
      await supabase.from('cc_project_disciplines').insert(
        missingDisc.map(discipline_id => ({
          project_id: parsed.data.cc_project_id,
          discipline_id,
          is_enabled: true,
          enabled_by: me?.id ?? null,
        })),
      )
    }
  }
  if (neededSubIds.length > 0) {
    const { data: existingSub } = await supabase
      .from('cc_project_sub_skills')
      .select('sub_skill_id')
      .eq('project_id', parsed.data.cc_project_id)
      .in('sub_skill_id', neededSubIds)
    const haveSub = new Set((existingSub ?? []).map(s => s.sub_skill_id as string))
    const missingSub = neededSubIds.filter(id => !haveSub.has(id))
    if (missingSub.length > 0) {
      await supabase.from('cc_project_sub_skills').insert(
        missingSub.map(sub_skill_id => ({
          project_id: parsed.data.cc_project_id,
          sub_skill_id,
          is_enabled: true,
          enabled_by: me?.id ?? null,
        })),
      )
    }
  }

  for (const r of toImport) {
    const sub_skill_id = r.sub_skill_id // may be null
    if (sub_skill_id) discWithSubLines.add(r.discipline_id)

    // Look up existing budget line for this (project, discipline, sub_skill, line_type='work').
    // BPH doesn't split work/material so we pick a single canonical bucket: 'work'.
    const baseQ = supabase
      .from('cc_budget_lines')
      .select('id, current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', parsed.data.cc_project_id)
      .eq('discipline_id', r.discipline_id)
      .eq('line_type', 'work')
    const { data: existing, error: lookupErr } = await (sub_skill_id === null
      ? baseQ.is('sub_skill_id', null)
      : baseQ.eq('sub_skill_id', sub_skill_id)
    ).maybeSingle()
    if (lookupErr) { errors.push(`${r.head}: ${lookupErr.message}`); skipped++; continue }

    if (existing) {
      const oldBudget = Number(existing.current_budget_amt) || 0
      const { error } = await supabase
        .from('cc_budget_lines')
        .update({
          current_budget_amt: r.budget,
          current_wo_committed_amt: r.woApproved,
          current_paid_amt: r.actual,
        })
        .eq('id', existing.id)
      if (error) { errors.push(`${r.head}: ${error.message}`); skipped++ }
      else {
        updated++
        // Audit the weekly drift — updates used to change figures silently.
        if (oldBudget !== r.budget) {
          const { error: evErr } = await supabase.from('cc_budget_events').insert({
            budget_line_id: existing.id,
            project_id: parsed.data.cc_project_id,
            event_type: 'budget_update',
            delta_amount: r.budget - oldBudget,
            remarks: `BPH sync: budget ${formatINR(oldBudget)} → ${formatINR(r.budget)} · ${r.head}`.slice(0, 500),
          })
          if (evErr) errors.push(`${r.head}: figures saved, but the audit event failed (${evErr.message})`)
        }
      }
    } else {
      const { data: newLine, error } = await supabase
        .from('cc_budget_lines')
        .insert({
          project_id: parsed.data.cc_project_id,
          discipline_id: r.discipline_id,
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

  // Remove now-redundant discipline-root summary lines for disciplines
  // that got sub-skill detail in this import. (Cleans up the stale lines
  // written by the earlier version that only read data.rows.) Only the
  // root line — sub_skill_id IS NULL — is deleted; the sub-skill lines we
  // just wrote replace it.
  for (const discId of discWithSubLines) {
    await supabase
      .from('cc_budget_lines')
      .delete()
      .eq('project_id', parsed.data.cc_project_id)
      .eq('discipline_id', discId)
      .eq('line_type', 'work')
      .is('sub_skill_id', null)
  }

  // Lines the previous pull wrote that are NOT in the report any more have
  // dropped out of IN4 — zero their ERP figures so stale numbers don't
  // linger. internal_estimate_* stays untouched, and only keys tracked in
  // last_pull are ever zeroed (Excel-imported / manual lines are safe).
  const presentKeySet = new Set(presentKeys ?? [])
  const zeroedKeys = new Set<string>()
  const staleKeys = canZeroStale ? prevKeys.filter(k => !presentKeySet.has(k)) : []
  for (const staleKey of staleKeys) {
    const [staleDiscId, staleSubId] = staleKey.split('::')
    if (!staleDiscId) continue
    const staleQ = supabase
      .from('cc_budget_lines')
      .select('id, current_budget_amt, current_wo_committed_amt, current_paid_amt')
      .eq('project_id', parsed.data.cc_project_id)
      .eq('discipline_id', staleDiscId)
      .eq('line_type', 'work')
    const { data: staleLine, error: staleErr } = await (staleSubId
      ? staleQ.eq('sub_skill_id', staleSubId)
      : staleQ.is('sub_skill_id', null)
    ).maybeSingle()
    if (staleErr || !staleLine) continue // line already deleted — nothing to zero
    const oldB = Number(staleLine.current_budget_amt) || 0
    const oldW = Number(staleLine.current_wo_committed_amt) || 0
    const oldP = Number(staleLine.current_paid_amt) || 0
    if (oldB === 0 && oldW === 0 && oldP === 0) continue
    const { error: zeroErr } = await supabase
      .from('cc_budget_lines')
      .update({ current_budget_amt: 0, current_wo_committed_amt: 0, current_paid_amt: 0 })
      .eq('id', staleLine.id)
    if (zeroErr) { errors.push(`Couldn't clear a line that left the report: ${zeroErr.message}`); continue }
    zeroedKeys.add(staleKey)
    const { error: zeroEvErr } = await supabase.from('cc_budget_events').insert({
      budget_line_id: staleLine.id,
      project_id: parsed.data.cc_project_id,
      event_type: 'budget_update',
      delta_amount: -oldB,
      remarks: 'BPH sync: line no longer in IN4 report — ERP figures zeroed',
    })
    if (zeroEvErr) errors.push(`Cleared a removed line, but the audit event failed (${zeroEvErr.message})`)
  }

  // Persist the BPH↔CT mapping so future BPH saves auto-pull. Upsert keyed
  // on bph_project_id (the BPH side); if the same BPH project is being
  // remapped to a different CT project (rare — usually a fix), update.
  // last_pull remembers which lines this pull wrote (drives the zeroing
  // above next time); unmatched_* feed the mapping screen.
  const now = new Date().toISOString()
  const { error: linkErr } = await supabase
    .from('cc_bph_project_links')
    .upsert({
      bph_project_id: parsed.data.bph_project_id,
      cc_project_id: parsed.data.cc_project_id,
      created_by: me?.id ?? null,
      last_pulled_at: now,
      last_pull_result: {
        inserted, updated, skipped,
        errors_count: errors.length,
        ...(unmatchedNames !== null
          ? { unmatched_count: unmatchedNames.length, unmatched_names: unmatchedNames.slice(0, 50) }
          : parsed.data.unmatched_count != null
            ? { unmatched_count: parsed.data.unmatched_count }
            : {}),
      },
      // Tracked keys = every line BPH has ever written that hasn't been
      // zeroed-out. Union with the previous set so a selective/partial
      // pull can never silently shrink the baseline (which would exempt
      // lines from future stale-detection).
      last_pull: {
        keys: Array.from(new Set([...prevKeys, ...pulledKeys])).filter(k => !zeroedKeys.has(k)),
        at: now,
      },
    }, { onConflict: 'bph_project_id' })
  if (linkErr) errors.push(`Pull saved, but its bookkeeping didn't (${linkErr.message})`)

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

export async function runAllMappedPulls(
  // Pass { client, actorId } for the unattended cron (service role, no user).
  opts?: ServiceOpts,
): Promise<{ ok: true; outcomes: MappedPullOutcome[]; ran_at: string }> {
  // Soft permission gate for the user-triggered path (/budget save hook):
  // only cost-control EDIT users may write CC budget lines / audit events,
  // so a non-CC user saving the BPH report doesn't pollute Cost Control.
  // The cron path (opts.client set) is service-role + trusted → skip the gate.
  if (!opts?.client) {
    const perms = await getMyPermissions()
    if (!can(perms, 'cost-control', 'edit')) {
      return { ok: true, outcomes: [], ran_at: new Date().toISOString() }
    }
  }

  // Best-effort: each pull catches its own error so one bad mapping
  // doesn't take down the whole sync.
  const supabase = (opts?.client ?? await createClient()) as CcClient

  // Respect the BPH auto-sync toggle (Settings → cc_bph_sync). Off (default) =
  // no automatic pull runs at all — neither the twice-daily cron nor the
  // on-upload auto-pull — so the IN4/BPH report never touches CC budgets.
  const { data: flagRow } = await supabase
    .from('app_settings').select('value').eq('key', 'cc_bph_sync').maybeSingle()
  const bphOn = ['true', '1', 'on'].includes(String(flagRow?.value ?? '').trim().toLowerCase())
  if (!bphOn) return { ok: true, outcomes: [], ran_at: new Date().toISOString() }

  const { data: links } = await supabase
    .from('cc_bph_project_links')
    .select('bph_project_id, cc_project_id')
  const ranAt = new Date().toISOString()
  const outcomes: MappedPullOutcome[] = []
  for (const link of links ?? []) {
    try {
      // useAi:false — nobody reviews this pull, so only exact/normalised
      // code matches are written. Unmatched rows are skipped and counted in
      // last_pull_result for the mapping screen.
      const r = await commitBphImport({
        bph_project_id: link.bph_project_id,
        cc_project_id: link.cc_project_id,
      }, { useAi: false, client: opts?.client, actorId: opts?.actorId })
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

// Is this CT project mapped to a BPH project? (Drives the project-page
// "Sync from BPH" button: re-sync when mapped, else send to map flow.)
export async function getBphMappingForProject(cc_project_id: string): Promise<{ bph_project_id: string } | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('cc_bph_project_links')
    .select('bph_project_id')
    .eq('cc_project_id', cc_project_id)
    .maybeSingle()
  return data ? { bph_project_id: data.bph_project_id as string } : null
}

// One-click re-sync from the project detail page. Looks up the mapping and
// re-runs the pull. Returns 'not_mapped' so the button can route to the
// map flow instead.
export async function resyncBphForProject(cc_project_id: string): Promise<CommitOutcome | { ok: false; error: string }> {
  await requirePermission('cost-control', 'edit')
  const supabase = await createClient()
  const { data: link } = await supabase
    .from('cc_bph_project_links')
    .select('bph_project_id')
    .eq('cc_project_id', cc_project_id)
    .maybeSingle()
  if (!link) return { ok: false, error: 'not_mapped' }
  // useAi:false — "Sync now" has no preview step, so AI must never guess a
  // mapping here; only exact/normalised code matches are written.
  return commitBphImport({ bph_project_id: link.bph_project_id as string, cc_project_id }, { useAi: false })
}
