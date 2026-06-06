import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { NewRequestForm } from './new-form'

export const dynamic = 'force-dynamic'

export default async function NewBlueprintDemoRequestPage() {
  await requirePermission('blueprint-demo', 'view')
  const supabase = await createClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('id, code, name')
    .order('code')

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <PageHeader
        title="Create demo request"
        back="/blueprint-demo/requests"
        subtitle="Seeds one row in the sandbox state machine starting at draft. Move it through the chain to feel the Smart Aging dashboard react in real time."
      />
      <Card className="p-5">
        <NewRequestForm projects={projects ?? []} />
      </Card>
    </div>
  )
}
