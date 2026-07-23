import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkCanSetDeadline, checkIsCcReviewer } from '@/components/cost-control/ws-actions'
import { getCcSettings } from '@/lib/cost-control/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { NewWSQuickForm } from './NewWSQuickForm'

export const dynamic = 'force-dynamic'

export default async function NewWorkingSheetQuickPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; discipline?: string; sub_skill?: string }>
}) {
  await requirePermission('cost-control', 'edit')
  const sp = await searchParams
  const supabase = await createClient()
  const ccSettings = await getCcSettings()

  // Reuse the same project / discipline / sub-skill data the regular New
  // page uses, so engineers see consistent options regardless of mode.
  const { data: projects } = await supabase
    .from('projects')
    .select('id, code, name')
    .not('cc_status', 'is', null)
    .order('code')

  const [pdRes, psRes] = await Promise.all([
    supabase
      .from('cc_project_disciplines')
      .select('project_id, discipline_id, cc_disciplines(id, code, name)')
      .eq('is_enabled', true),
    supabase
      .from('cc_project_sub_skills')
      .select('project_id, sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
      .eq('is_enabled', true),
  ])

  type DRow = { id: string; code: string; name: string }
  type SRow = { id: string; discipline_id: string; code: string; name: string }
  type PDJoin = { project_id: string; cc_disciplines: DRow | DRow[] | null }
  type PSJoin = { project_id: string; cc_sub_skills: SRow | SRow[] | null }

  const projectDisciplines: Array<{ project_id: string; discipline: DRow }> = []
  for (const r of (pdRes.data ?? []) as PDJoin[]) {
    const d = Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines
    if (d) projectDisciplines.push({ project_id: r.project_id, discipline: d })
  }
  const projectSubSkills: Array<{ project_id: string; sub_skill: SRow }> = []
  for (const r of (psRes.data ?? []) as PSJoin[]) {
    const s = Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills
    if (s) projectSubSkills.push({ project_id: r.project_id, sub_skill: s })
  }

  // Raising from a sub-skill that already has sheets? Pull the LATEST live
  // version's BOQ so the downloaded template is pre-filled as the next version
  // (engineer edits deltas → identical descriptions → clean v-to-v matching).
  type SeedRow = { description: string; unit: string | null; qty: number | null; qtyFormula: string | null; material: number | null; installation: number | null; ml: number | null }
  let priorVersion:
    | { versionNo: number; wsCode: string; lineType: 'work' | 'material' | 'combined' | null; rows: SeedRow[] }
    | null = null
  if (sp.project && sp.discipline && sp.sub_skill) {
    const { data: chainRows } = await supabase
      .from('cc_ws_with_versions')
      .select('id, ws_code, version_no, line_type, status, summary_notes, archived_at, created_at')
      .eq('project_id', sp.project)
      .eq('discipline_id', sp.discipline)
      .eq('sub_skill_id', sp.sub_skill)
    const live = (chainRows ?? []).filter(w =>
      !(w.summary_notes ?? '').startsWith('[IB') && w.status !== 'cancelled' && !w.archived_at,
    )
    live.sort((a, b) => (b.version_no ?? 0) - (a.version_no ?? 0) || String(b.created_at).localeCompare(String(a.created_at)))
    const latest = live[0]
    if (latest) {
      const { data: pr } = await supabase
        .from('cc_excel_rows')
        .select('description, unit, qty, rate, rate_breakdown, qty_formula, row_no')
        .eq('working_sheet_id', latest.id)
        .order('row_no')
      const rows: SeedRow[] = (pr ?? [])
        .filter(r => (r.description ?? '').trim())
        .map(r => {
          const bd = (r.rate_breakdown ?? []) as Array<{ label: string; value: number }>
          const material = bd.find(b => /material/i.test(b.label))?.value ?? null
          const installation = bd.find(b => /install/i.test(b.label))?.value ?? null
          const mlBd = bd.find(b => /m\s*\+\s*l|combined/i.test(b.label))?.value ?? null
          const ml = mlBd ?? (material == null && installation == null && r.rate != null ? Number(r.rate) : null)
          return {
            description: String(r.description ?? ''),
            unit: r.unit ?? null,
            qty: r.qty != null ? Number(r.qty) : null,
            qtyFormula: (r as { qty_formula?: string | null }).qty_formula ?? null,
            material, installation, ml,
          }
        })
      if (rows.length > 0) {
        priorVersion = {
          versionNo: latest.version_no ?? 1,
          wsCode: latest.ws_code,
          lineType: (latest.line_type as 'work' | 'material' | 'combined' | null) ?? null,
          rows,
        }
      }
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Raise Budget Request"
        subtitle="Upload the standard BOQ template — we parse the rows, flag rate outliers, and route it for approval."
        back={sp.project ? `/cost-control/projects/${sp.project}` : "/cost-control/working-sheets"}
      />
      <Card className="p-5">
        <NewWSQuickForm
          projects={projects ?? []}
          projectDisciplines={projectDisciplines}
          projectSubSkills={projectSubSkills}
          defaultProjectId={sp.project}
          defaultDisciplineId={sp.discipline}
          defaultSubSkillId={sp.sub_skill}
          canSetDeadline={(await checkCanSetDeadline()) && ccSettings.show_deadlines}
          reviewer={await checkIsCcReviewer()}
          cumulativeVersions={ccSettings.cumulative_versions}
          priorVersion={priorVersion}
        />
      </Card>
    </div>
  )
}
