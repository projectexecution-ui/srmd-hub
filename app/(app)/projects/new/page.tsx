import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { ProjectForm } from '../project-form'

export default async function NewProjectPage() {
  await requirePermission('projects', 'edit', '/projects')

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <PageHeader title="New Project" back="/projects" />
      <Card><CardContent className="pt-6"><ProjectForm /></CardContent></Card>
    </div>
  )
}
