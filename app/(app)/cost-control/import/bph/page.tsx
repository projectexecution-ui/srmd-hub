import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { FileSpreadsheet } from 'lucide-react'
import { BphImportClient } from './BphImportClient'
import { listBphProjects } from './actions'

export const dynamic = 'force-dynamic'

export default async function BphImportPage({
  searchParams,
}: {
  searchParams: Promise<{ cc_project?: string }>
}) {
  await requirePermission('cost-control', 'edit')
  const sp = await searchParams
  const supabase = await createClient()

  const [bphRes, ccProjectsRes] = await Promise.all([
    listBphProjects(),
    supabase.from('projects').select('id, code, name, cc_status').not('cc_status', 'is', null).order('code'),
  ])

  if (!bphRes.ok) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
        <PageHeader
          title="Pull from BPH report"
          subtitle="Use your weekly IN4 Budget Performance Hub upload to populate Cost Control budgets"
          back="/cost-control/import"
        />
        <Card className="p-5 border-rose-200 bg-rose-50 text-sm text-rose-900">
          Couldn&apos;t read BPH state: {bphRes.error}
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Pull from BPH report"
        subtitle="Use your weekly IN4 Budget Performance Hub upload (/budget) to fill Approved Budget (ERP) here — no second upload needed"
        back="/cost-control/import"
      />

      <Card className="p-3 bg-blue-50/50 border-blue-200 text-xs text-blue-900">
        Match a BPH project to a Cost Control project, preview the rows, and commit. Each row&apos;s
        category code (e.g. 11) maps to a discipline; sub-category (e.g. 1102) maps to a sub-skill.
        Rows where the codes don&apos;t match anything in your discipline master will be flagged so you
        can fix them later. Re-running this overwrites the existing budget lines with the latest
        BPH numbers — that&apos;s the point of pulling weekly.
      </Card>

      {bphRes.projects.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSpreadsheet className="h-10 w-10" />}
            title="No BPH data uploaded yet"
            description="Upload your IN4 Budget Performance Hub Excel at /budget first. Once that's done, projects with parsed rows will show up here."
          />
        </Card>
      ) : (
        <BphImportClient
          bphProjects={bphRes.projects}
          ccProjects={(ccProjectsRes.data ?? []).map(p => ({ id: p.id, code: p.code, name: p.name }))}
          defaultCcProjectId={sp.cc_project ?? null}
        />
      )}
    </div>
  )
}
