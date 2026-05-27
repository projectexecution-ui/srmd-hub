import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatPill } from '@/components/ui/stat-pill'
import { ClipboardList, FileText, Pencil, MapPin, Info, Users as UsersIcon } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { ProjectForm } from '../project-form'
import { ProjectDeleteButton } from '@/components/ProjectDeleteButton'
import type { ProjectFloor } from '@/lib/types'
import ProjectUsersTab from './project-users-tab'

export const dynamic = 'force-dynamic'

type Tab = 'overview' | 'users'

export default async function ProjectDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ edit?: string; tab?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const editing = sp.edit === '1'
  const tab: Tab = sp.tab === 'users' ? 'users' : 'overview'

  const perms = await requirePermission('projects', 'view')
  const canWrite = can(perms, 'projects', 'edit')
  const profile = await getMyProfile()
  const canManageUsers = profile?.role === 'admin' || !!profile?.is_portal_owner
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('*').eq('id', id).single()
  if (!project) notFound()

  const [indentsRes, posRes, floorsRes, assignmentsRes, profilesRes] = await Promise.all([
    supabase.from('indents').select('id', { count: 'exact', head: true }).eq('project_id', id),
    supabase.from('purchase_orders').select('id, po_amount').eq('project_id', id),
    supabase.from('project_floors').select('*').eq('project_id', id).order('sequence'),
    supabase.from('project_assignments')
      .select('id, user_id, role, assigned_at')
      .eq('project_id', id)
      .order('assigned_at', { ascending: false }),
    supabase.from('profiles')
      .select('id, name, full_name, email, role, is_active')
      .eq('is_active', true)
      .order('name'),
  ])
  const floors = (floorsRes.data ?? []) as ProjectFloor[]
  const indentCount = indentsRes.count ?? 0
  const posTotal = (posRes.data ?? []).reduce((s, p) => s + Number(p.po_amount ?? 0), 0)
  const poCount = posRes.data?.length ?? 0
  const assignments = assignmentsRes.data ?? []
  const allProfiles = profilesRes.data ?? []
  const assignmentCount = assignments.length

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title={`${project.code} — ${project.name}`} back="/projects">
        {project.status && <Badge variant={project.status === 'active' ? 'success' : 'secondary'}>{project.status}</Badge>}
        {!editing && canWrite && (
          <>
            <Button asChild size="sm" variant="outline">
              <Link href={`/projects/${id}?edit=1`}><Pencil className="h-4 w-4" /> Edit</Link>
            </Button>
            <ProjectDeleteButton projectId={id} projectName={`${project.code} — ${project.name}`} redirectTo="/projects" />
          </>
        )}
      </PageHeader>

      {/* Tabs — hidden in edit mode to keep the form full-width */}
      {!editing && (
        <div className="flex gap-2 border-b border-gray-200 -mx-4 px-4 md:mx-0 md:px-0">
          <TabLink href={`/projects/${id}`} active={tab === 'overview'} icon={Info} label="Overview" />
          <TabLink href={`/projects/${id}?tab=users`} active={tab === 'users'} icon={UsersIcon} label="Users" count={assignmentCount} />
        </div>
      )}

      {editing ? (
        <Card><CardContent className="pt-6"><ProjectForm initial={project} initialFloors={floors} projectId={id} /></CardContent></Card>
      ) : tab === 'users' ? (
        <ProjectUsersTab
          projectId={id}
          initialAssignments={assignments}
          allProfiles={allProfiles}
          canManage={canManageUsers}
        />
      ) : (
        <>
          {(project.location || project.description) && (
            <Card>
              <CardContent className="pt-5 space-y-2">
                {project.location && (
                  <p className="text-sm text-gray-700 flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    {project.location}
                  </p>
                )}
                {project.description && (
                  <p className="text-sm text-gray-700 whitespace-pre-line">{project.description}</p>
                )}
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatPill label="Indents" value={indentCount} icon={<ClipboardList className="h-5 w-5" />} />
            <StatPill label="POs" value={poCount} icon={<FileText className="h-5 w-5" />} />
            <StatPill label="PO Value" value={formatINR(posTotal)} />
          </div>

          <AreaStatementPanel project={project} floors={floors} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm"><Link href={`/indents?project=${id}`}>View indents</Link></Button>
                <Button asChild variant="outline" size="sm"><Link href={`/pos?project=${id}`}>View POs</Link></Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

// ─── Area Statement panel (read-only) ──────────────────────────────
function fmt(n: number | null | undefined, unit = '') {
  if (n == null) return '—'
  const v = Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  return unit ? `${v} ${unit}` : v
}

function AreaStatementPanel({ project, floors }: {
  project: {
    plot_area_sft?: number | null
    built_up_sft?: number | null
    carpet_sft?: number | null
    super_built_up_sft?: number | null
    fsi_permitted?: number | null
    fsi_consumed?: number | null
  }
  floors: ProjectFloor[]
}) {
  const hasAnyArea = [
    project.plot_area_sft, project.built_up_sft, project.carpet_sft,
    project.super_built_up_sft, project.fsi_permitted, project.fsi_consumed,
  ].some(v => v != null) || floors.length > 0

  if (!hasAnyArea) return null

  const fsiPct = (project.fsi_permitted && project.fsi_consumed)
    ? Math.round((Number(project.fsi_consumed) / Number(project.fsi_permitted)) * 100)
    : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Area Statement</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <AreaCell label="Plot area"     value={fmt(project.plot_area_sft, 'sq ft')} />
          <AreaCell label="Built-up"      value={fmt(project.built_up_sft, 'sq ft')} />
          <AreaCell label="Carpet"        value={fmt(project.carpet_sft, 'sq ft')} />
          <AreaCell label="Super built-up" value={fmt(project.super_built_up_sft, 'sq ft')} />
          <AreaCell label="FSI permitted" value={fmt(project.fsi_permitted)} />
          <AreaCell label="FSI consumed"  value={fmt(project.fsi_consumed)} />
          {fsiPct != null && <AreaCell label="FSI utilisation" value={`${fsiPct}%`} />}
        </div>

        {floors.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Floor breakdown</p>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm border border-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-3 py-2">Floor</th>
                    <th className="px-3 py-2 text-right">Built-up (sq ft)</th>
                    <th className="px-3 py-2 text-right">Carpet (sq ft)</th>
                  </tr>
                </thead>
                <tbody>
                  {floors.map(f => (
                    <tr key={f.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-800">{f.name}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{fmt(f.built_up_sft)}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{fmt(f.carpet_sft)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AreaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900 mt-0.5">{value}</p>
    </div>
  )
}

function TabLink({
  href, active, icon: Icon, label, count,
}: {
  href: string
  active: boolean
  icon: React.ComponentType<{ className?: string }>
  label: string
  count?: number
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors',
        active
          ? 'border-blue-600 text-blue-700 font-semibold'
          : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className={cn(
          'inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[10px] font-bold',
          active ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600',
        )}>
          {count}
        </span>
      )}
    </Link>
  )
}
