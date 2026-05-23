import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Building2, Plus } from 'lucide-react'
import { ProjectDeleteButton } from '@/components/ProjectDeleteButton'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const perms = await requirePermission('projects', 'view')
  const canWrite = can(perms, 'projects', 'edit')
  const supabase = await createClient()

  const { data: projects } = await supabase
    .from('projects')
    .select('id, code, name, description, status, parent_project_id')
    .is('parent_project_id', null)
    .order('code')

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="Projects" subtitle={`${projects?.length ?? 0} project${projects?.length === 1 ? '' : 's'}`}>
        {canWrite && (
          <Button asChild size="sm">
            <Link href="/projects/new"><Plus className="h-4 w-4" /> New Project</Link>
          </Button>
        )}
      </PageHeader>

      {projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <Card key={p.id} className="hover:shadow-md transition-shadow h-full flex flex-col">
              <Link href={`/projects/${p.id}`} className="flex-1">
                <div className="p-5">
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-xs font-mono font-bold text-blue-700">{p.code}</span>
                    {p.status && <Badge variant={p.status === 'active' ? 'success' : 'secondary'}>{p.status}</Badge>}
                  </div>
                  <h3 className="font-semibold text-gray-900">{p.name}</h3>
                  {p.description && (
                    <p className="text-sm text-gray-500 mt-2 line-clamp-2">{p.description}</p>
                  )}
                </div>
              </Link>
              {canWrite && (
                <div className="px-5 pb-4 pt-0 flex justify-end">
                  <ProjectDeleteButton projectId={p.id} projectName={`${p.code} — ${p.name}`} redirectTo="/projects" />
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            icon={<Building2 className="h-10 w-10" />}
            title="No projects yet"
            action={canWrite ? <Button asChild size="sm"><Link href="/projects/new">Add first project</Link></Button> : null}
          />
        </Card>
      )}
    </div>
  )
}
