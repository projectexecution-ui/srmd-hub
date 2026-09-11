import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getMyProfile, isPortalOwner } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { loadPeopleData } from '../people/load'
import { ProjectsClient } from './ProjectsClient'

export const dynamic = 'force-dynamic'

/**
 * Projects — the second Admin door (11 Sep 2026). One card per project: who
 * signs each stage, who works on it, who sees its indents, where its bills desk
 * is set. The same rows as the People grids, seen from the project's side.
 */
export default async function AdminProjectsPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const [profile, owner] = await Promise.all([getMyProfile(), isPortalOwner()])
  if (!profile || !(owner || profile.role === 'admin')) redirect('/admin')
  const { project } = await searchParams
  const data = await loadPeopleData()
  const noHead = data.projects.filter(p => !p.isGroup && !data.approvers.some(a => a.project_id === p.id && a.role === 'project_head'))

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Projects"
        back="/admin"
        subtitle="Who signs each project, who works on it, who sees its indents."
      />
      <p className="text-[12px] text-gray-500">
        Per-person view: <Link href="/admin/people" className="text-indigo-700 hover:underline">People</Link>. Create a project: <Link href="/cost-control/projects/new" className="text-indigo-700 hover:underline">New project</Link>. Signing rules by module: <Link href="/admin/approvals" className="text-indigo-700 hover:underline">Who signs, in what order</Link>.
      </p>
      <ProjectsClient data={data} initialProject={project ?? noHead[0]?.id} noHead={noHead.map(p => ({ id: p.id, label: p.label }))} />
    </div>
  )
}
