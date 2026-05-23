import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Building2 } from 'lucide-react'
import { ProjectsBuilder } from './projects-builder'

export const dynamic = 'force-dynamic'

export default async function JmrAdminProjectsPage() {
  const perms = await requirePermission('jmr-admin', 'view')
  const canEdit = can(perms, 'jmr-admin', 'edit')
  const supabase = await createClient()

  // All projects (we'll group into parents + children in the builder).
  const { data: all } = await supabase
    .from('projects')
    .select('id, code, name, description, status, parent_project_id')
    .order('code', { ascending: true, nullsFirst: false })
    .order('name')

  const projects = all ?? []
  const tops = projects.filter(p => !p.parent_project_id)
  const childrenBy = projects
    .filter(p => p.parent_project_id)
    .reduce<Record<string, typeof projects>>((acc, p) => {
      const k = p.parent_project_id as string
      ;(acc[k] ||= []).push(p)
      return acc
    }, {})

  return (
    <>
      <div className="mb-3">
        <p className="text-sm text-gray-500">
          {tops.length} top-level project{tops.length === 1 ? '' : 's'}
          {' · '}
          {projects.length - tops.length} sub-project{projects.length - tops.length === 1 ? '' : 's'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Projects live in the shared <span className="font-mono">public.projects</span> table — what you add here is visible to other modules too (Indents, POs, Cost Control). Sub-projects (NGH-A, NGH-B&hellip;) become the column headers in the JMR matrix.
        </p>
      </div>
      {tops.length === 0 && !canEdit ? (
        <Card>
          <EmptyState
            icon={<Building2 className="h-10 w-10" />}
            title="No projects yet"
          />
        </Card>
      ) : (
        <ProjectsBuilder
          tops={tops}
          childrenBy={childrenBy}
          canEdit={canEdit}
        />
      )}
    </>
  )
}
