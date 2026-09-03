import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { descendantIds } from '@/lib/revamp/hierarchy'
import type { SourceLine } from '@/lib/revamp/sc-budgets'
import { ScBudgetsClient } from './ScBudgetsClient'

/**
 * SC Budgets — top-management report, sourced from cc_budget_lines.
 *
 * Loads every project's lines rather than only this one's, because the report
 * exists to be a portfolio hand-out: you arrive from inside a project, it opens
 * on that project, and any other can be added without leaving the page.
 *
 * Confidentiality is enforced by the route, on `budget-vs-actual-v2` — admin
 * and head only. Nothing here re-checks it, so there is one gate rather than
 * two that can drift.
 */
export async function ScBudgetsTab({ projectId }: { projectId: string }) {
  const supabase = await createClient()

  const [projRes, lineRes, discRes, subRes] = await Promise.all([
    supabase.from('projects').select('id, name, built_up_sft, parent_project_id').is('archived_at', null),
    supabase.from('cc_budget_lines')
      .select('project_id, discipline_id, sub_skill_id, current_budget_amt, current_wo_committed_amt, current_paid_amt, internal_estimate_amt'),
    supabase.from('cc_disciplines').select('id, code, name'),
    supabase.from('cc_sub_skills').select('id, code, name'),
  ])

  type Proj = { id: string; name: string; built_up_sft: number | null; parent_project_id: string | null }
  const projects = (projRes.data ?? []) as Proj[]
  const here = projects.find(p => p.id === projectId)
  if (!here) notFound()

  const projById = new Map(projects.map(p => [p.id, p]))
  const discById = new Map(((discRes.data ?? []) as Array<{ id: string; code: string; name: string }>).map(d => [d.id, d]))
  const subById = new Map(((subRes.data ?? []) as Array<{ id: string; code: string; name: string }>).map(x => [x.id, x]))

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

  const lines: SourceLine[] = ((lineRes.data ?? []) as Array<Record<string, unknown>>)
    .map(r => {
      const p = projById.get(r.project_id as string)
      const d = discById.get(r.discipline_id as string)
      // A line whose project is archived or whose category is gone cannot be
      // labelled, so it is dropped rather than shown as blank in a report that
      // goes to the Trustee.
      if (!p || !d) return null
      const sub = r.sub_skill_id ? subById.get(r.sub_skill_id as string) : undefined
      return {
        projectId: p.id,
        projectName: p.name,
        disciplineCode: d.code,
        disciplineName: d.name,
        subCode: sub?.code ?? null,
        subName: sub?.name ?? null,
        ie: num(r.internal_estimate_amt),
        budget: num(r.current_budget_amt),
        wo: num(r.current_wo_committed_amt),
        paid: num(r.current_paid_amt),
        sft: num(p.built_up_sft),
      }
    })
    .filter((l): l is SourceLine => l !== null)

  // A group opens covering its children, matching every other money view in
  // the cockpit — otherwise opening NGH shows nothing while NGH A/B/C hold it.
  const covered = new Set(descendantIds(
    projects.map(p => ({ id: p.id, parentId: p.parent_project_id })),
    projectId,
  ))
  const openOn = projects.filter(p => covered.has(p.id)).map(p => p.id)

  return (
    <ScBudgetsClient
      lines={lines}
      projectName={here.name}
      openOn={openOn}
      allProjects={projects
        .map(p => ({ id: p.id, name: p.name }))
        .sort((a, b) => a.name.localeCompare(b.name))}
    />
  )
}
