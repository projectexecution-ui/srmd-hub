import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { checkCanSetDeadline } from '@/components/cost-control/ws-actions'
import { getCcSettings } from '@/lib/cost-control/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { FileSpreadsheet, ChevronRight } from 'lucide-react'
import { NewWSForm } from './NewWSForm'

export const dynamic = 'force-dynamic'

export default async function NewWorkingSheetPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; discipline?: string; sub_skill?: string }>
}) {
  await requirePermission('cost-control', 'edit')
  const sp = await searchParams
  const supabase = await createClient()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, code, name')
    .not('cc_status', 'is', null)
    .order('code')

  // Pull every project's enabled disciplines + sub-skills in one go;
  // form will narrow client-side as the user picks a project.
  const [pdRes, psRes] = await Promise.all([
    supabase
      .from('cc_project_disciplines')
      .select('project_id, discipline_id, estimation_mode, cc_disciplines(id, code, name)')
      .eq('is_enabled', true),
    supabase
      .from('cc_project_sub_skills')
      .select('project_id, sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
      .eq('is_enabled', true),
  ])

  // (project_id, discipline_id) pairs flagged as thumbrule. Form warns the
  // engineer to use the dedicated thumbrule page when picked.
  const thumbruleKeys = new Set<string>(
    (pdRes.data ?? [])
      .filter((r: { estimation_mode?: string | null }) => r.estimation_mode === 'thumbrule')
      .map((r: { project_id: string; discipline_id: string }) => `${r.project_id}::${r.discipline_id}`),
  )

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

  const canSetDeadline = (await checkCanSetDeadline()) && (await getCcSettings()).show_deadlines

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <PageHeader
        title="New Working Sheet"
        subtitle="Pick the project + sub-skill this sheet is for"
        back={sp.project ? `/cost-control/projects/${sp.project}` : "/cost-control/working-sheets"}
      />

      {/* Quick Mode call-out — more discoverable than the list page button.
          Carry the project + sub-skill context so it stays prefilled there too. */}
      <Link
        href={`/cost-control/working-sheets/new-quick${
          sp.project
            ? `?project=${sp.project}${sp.discipline ? `&discipline=${sp.discipline}` : ''}${sp.sub_skill ? `&sub_skill=${sp.sub_skill}` : ''}`
            : ''
        }`}
        className="block rounded-2xl border-2 border-dashed border-green-300 bg-green-50/40 hover:bg-green-50 hover:border-green-400 p-4 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-green-100 text-green-700 flex items-center justify-center flex-shrink-0">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">Already done quantification in Excel?</p>
            <p className="text-xs text-gray-600">Switch to <b>Quick mode</b> — attach the .xlsx and we&apos;ll parse rows + flag rate outliers for you.</p>
          </div>
          <ChevronRight className="h-5 w-5 text-green-700 flex-shrink-0" />
        </div>
      </Link>

      <Card className="p-5">
        <NewWSForm
          projects={projects ?? []}
          projectDisciplines={projectDisciplines}
          projectSubSkills={projectSubSkills}
          defaultProjectId={sp.project}
          defaultDisciplineId={sp.discipline}
          defaultSubSkillId={sp.sub_skill}
          canSetDeadline={canSetDeadline}
          thumbruleKeys={Array.from(thumbruleKeys)}
        />
      </Card>
    </div>
  )
}
