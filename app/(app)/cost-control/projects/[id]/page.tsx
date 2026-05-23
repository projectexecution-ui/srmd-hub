import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SetupProgressBanner } from '@/components/ProjectSetupWizard/SetupProgressBanner'
import { Plus, FileText, ClipboardList } from 'lucide-react'
import { formatINR } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface DisciplineRow {
  id: string
  code: string
  name: string
  display_order: number
}

interface SubSkillRow {
  id: string
  discipline_id: string
  code: string
  name: string
}

export default async function CostControlProjectDetailPage(
  { params }: { params: Promise<{ id: string }> }
) {
  const perms = await requirePermission('cost-control', 'view')
  const canWrite = can(perms, 'cost-control', 'edit')
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, code, name, description, cc_status, setup_progress_pct, built_up_sft, parent_project_id, pm_user_id, start_date, target_completion')
    .eq('id', id)
    .single()

  if (!project) notFound()

  // Pull enabled disciplines + their sub-skills + engineer assignments + WS roll-ups in parallel
  const [projDisRes, projSubRes, assignRes, profilesRes, wsRollupRes] = await Promise.all([
    supabase
      .from('cc_project_disciplines')
      .select('discipline_id, cc_disciplines(id, code, name, display_order)')
      .eq('project_id', id)
      .eq('is_enabled', true),
    supabase
      .from('cc_project_sub_skills')
      .select('sub_skill_id, cc_sub_skills(id, discipline_id, code, name)')
      .eq('project_id', id)
      .eq('is_enabled', true),
    supabase
      .from('project_assignments')
      .select('user_id, role, assigned_disciplines')
      .eq('project_id', id)
      .eq('role', 'engineer'),
    supabase.from('profiles').select('id, full_name, name'),
    supabase
      .from('cc_working_sheets')
      .select('id, status, total_amount')
      .eq('project_id', id),
  ])

  type ProjDisJoinRow = { discipline_id: string; cc_disciplines: DisciplineRow | DisciplineRow[] | null }
  type ProjSubJoinRow = { sub_skill_id: string; cc_sub_skills: SubSkillRow | SubSkillRow[] | null }

  const disciplines: DisciplineRow[] = ((projDisRes.data ?? []) as ProjDisJoinRow[])
    .map(r => Array.isArray(r.cc_disciplines) ? r.cc_disciplines[0] : r.cc_disciplines)
    .filter((d): d is DisciplineRow => !!d)
    .sort((a, b) => a.display_order - b.display_order)

  const subSkills: SubSkillRow[] = ((projSubRes.data ?? []) as ProjSubJoinRow[])
    .map(r => Array.isArray(r.cc_sub_skills) ? r.cc_sub_skills[0] : r.cc_sub_skills)
    .filter((s): s is SubSkillRow => !!s)

  type ProfileLite = { id: string; full_name: string | null; name: string | null }
  const profileMap = new Map<string, string>()
  for (const p of (profilesRes.data ?? []) as ProfileLite[]) {
    profileMap.set(p.id, p.full_name ?? p.name ?? '(unnamed)')
  }

  type AssignmentRow = { user_id: string; role: string; assigned_disciplines: string[] | null }
  const engineers = ((assignRes.data ?? []) as AssignmentRow[]).map(a => ({
    user_id: a.user_id,
    name: profileMap.get(a.user_id) ?? '(unknown)',
    discipline_ids: a.assigned_disciplines ?? [],
  }))

  type WSRollupRow = { id: string; status: string; total_amount: number | null }
  const wsRollup = (wsRollupRes.data ?? []) as WSRollupRow[]
  const wsCount = wsRollup.length
  const wsDrafts = wsRollup.filter(w => w.status === 'draft').length
  const wsPending = wsRollup.filter(w => w.status === 'submitted').length
  const wsApprovedTotal = wsRollup.filter(w => w.status === 'approved' || w.status === 'wo_issued' || w.status === 'paid')
    .reduce((s, w) => s + Number(w.total_amount ?? 0), 0)

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title={project.name}
        subtitle={`${project.code}${project.built_up_sft ? ` · ${project.built_up_sft.toLocaleString('en-IN')} Sft` : ''}${project.start_date ? ` · started ${new Date(project.start_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}`}
        back="/cost-control"
      >
        {project.cc_status && (
          <Badge variant={project.cc_status === 'active' ? 'success' : 'secondary'}>
            {project.cc_status.replace('_', ' ')}
          </Badge>
        )}
        {canWrite && (
          <Button asChild size="sm">
            <Link href={`/cost-control/working-sheets/new?project=${project.id}`}>
              <Plus className="h-4 w-4" /> New Working Sheet
            </Link>
          </Button>
        )}
      </PageHeader>

      {project.cc_status && (
        <SetupProgressBanner
          projectId={project.id}
          progressPct={project.setup_progress_pct ?? 0}
        />
      )}

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Working Sheets" value={wsCount} hint={`${wsDrafts} draft · ${wsPending} pending`} icon={<FileText className="h-5 w-5" />} />
        <Stat label="Approved value" value={formatINR(wsApprovedTotal)} hint="across approved + WO + paid" icon={<ClipboardList className="h-5 w-5" />} />
        <Stat label="Disciplines" value={disciplines.length} icon={<ClipboardList className="h-5 w-5" />} />
        <Stat label="Engineers" value={engineers.length} icon={<ClipboardList className="h-5 w-5" />} />
      </div>

      {/* Disciplines + their sub-skills */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Enabled disciplines & sub-skills</h2>
          {canWrite && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/cost-control/projects/new`}>
                <Plus className="h-3.5 w-3.5" /> Add via Setup
              </Link>
            </Button>
          )}
        </div>

        {disciplines.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-10 w-10" />}
            title="No disciplines enabled yet"
            description="Open the Setup Wizard from the banner above to pick disciplines and sub-skills."
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {disciplines.map(d => {
              const subs = subSkills.filter(s => s.discipline_id === d.id)
              return (
                <div key={d.id} className="rounded-md border border-gray-200 bg-white">
                  <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-md">
                    <span className="font-mono text-xs text-gray-500 mr-2">{d.code}</span>
                    <span className="font-semibold text-gray-900">{d.name}</span>
                    <span className="ml-2 text-xs text-gray-500">· {subs.length} sub-skill{subs.length === 1 ? '' : 's'}</span>
                  </div>
                  {subs.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-gray-500 italic">No sub-skills enabled.</p>
                  ) : (
                    <ul className="px-3 py-2 text-sm text-gray-700 space-y-0.5">
                      {subs.map(s => (
                        <li key={s.id} className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-gray-400">{s.code}</span>
                          <span className="truncate">{s.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Engineers */}
      <Card className="p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Engineers assigned</h2>
        {engineers.length === 0 ? (
          <p className="text-sm text-gray-500">No engineers assigned to this project yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {engineers.map(e => {
              const dCodes = disciplines.filter(d => e.discipline_ids.includes(d.id)).map(d => d.code)
              return (
                <div key={e.user_id} className="rounded-md border border-gray-200 p-3">
                  <p className="font-semibold text-sm text-gray-900">{e.name}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {dCodes.length > 0 ? dCodes.join(', ') : 'no disciplines yet'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value, hint, icon }: { label: string; value: React.ReactNode; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-3">
        {icon && <div className="p-2 rounded-lg bg-indigo-50 text-indigo-700">{icon}</div>}
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-lg font-bold text-gray-900 truncate">{value}</p>
          {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
        </div>
      </div>
    </div>
  )
}
