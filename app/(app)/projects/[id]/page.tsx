import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatPill } from '@/components/ui/stat-pill'
import { ClipboardList, FileText, Pencil } from 'lucide-react'
import { formatINR } from '@/lib/utils'
import { ProjectForm } from '../project-form'

export const dynamic = 'force-dynamic'

export default async function ProjectDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ edit?: string }>
}) {
  const { id } = await params
  const sp = await searchParams
  const editing = sp.edit === '1'

  const perms = await requirePermission('projects', 'view')
  const canWrite = can(perms, 'projects', 'edit')
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('*').eq('id', id).single()
  if (!project) notFound()

  const [indentsRes, posRes] = await Promise.all([
    supabase.from('indents').select('id', { count: 'exact', head: true }).eq('project_id', id),
    supabase.from('purchase_orders').select('id, po_amount').eq('project_id', id),
  ])
  const indentCount = indentsRes.count ?? 0
  const posTotal = (posRes.data ?? []).reduce((s, p) => s + Number(p.po_amount ?? 0), 0)
  const poCount = posRes.data?.length ?? 0

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader title={`${project.code} — ${project.name}`} back="/projects">
        {project.status && <Badge variant={project.status === 'active' ? 'success' : 'secondary'}>{project.status}</Badge>}
        {!editing && canWrite && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/projects/${id}?edit=1`}><Pencil className="h-4 w-4" /> Edit</Link>
          </Button>
        )}
      </PageHeader>

      {editing ? (
        <Card><CardContent className="pt-6"><ProjectForm initial={project} projectId={id} /></CardContent></Card>
      ) : (
        <>
          {project.description && (
            <Card>
              <CardContent className="pt-5">
                <p className="text-sm text-gray-700 whitespace-pre-line">{project.description}</p>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatPill label="Indents" value={indentCount} icon={<ClipboardList className="h-5 w-5" />} />
            <StatPill label="POs" value={poCount} icon={<FileText className="h-5 w-5" />} />
            <StatPill label="PO Value" value={formatINR(posTotal)} />
          </div>

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
