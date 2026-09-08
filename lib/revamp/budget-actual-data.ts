// Server loader for Budget vs Actual's CT-wise pill (build order §2).
//
// Pill 1 no longer lives here: the Budget tab renders the live Internal
// Estimate page itself, so there is nothing left to recompute. What remains
// is the IN4 sub-project roll-up, which has no equivalent on the live site.
//
// Returns its Supabase `error` rather than swallowing it. §10: show the
// error, never a silent empty state.

import { fetchAll } from './orders-tree'
import { createClient } from '@/lib/supabase/server'

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

  // Paged. PostgREST stops at 1,000 rows and says nothing; Raj Uphaar has
  // 1,987 certificates, so the un-paged read summed about half of them and
  // the Certified figure on this screen was wrong (audit F-002).
  const [woRes, certRes] = await Promise.all([
    fetchAll<{ subproject_id: number; wo_value: number | null }>((f, t) =>
      supabase.from('in4_work_orders').select('subproject_id, wo_value').in('subproject_id', ids).range(f, t)),
    fetchAll<{ subproject_id: number; certified_amt: number | null }>((f, t) =>
      supabase.from('in4_wo_certificates').select('subproject_id, certified_amt').in('subproject_id', ids).range(f, t)),
  ])
  const err = woRes.error ?? certRes.error
  if (err) return { rows: [], total: null, error: err, note }

  const woBy = new Map<number, number>()
  for (const w of woRes.rows) {
    woBy.set(w.subproject_id, (woBy.get(w.subproject_id) ?? 0) + Number(w.wo_value ?? 0))
  }
  const certBy = new Map<number, number>()
  for (const c of certRes.rows) {
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
