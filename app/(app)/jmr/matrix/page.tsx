import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileSpreadsheet, FileText } from 'lucide-react'
import { getJmrSettings } from '@/lib/jmr/settings'
import { buildMatrix } from '@/lib/jmr/matrix'
import { MatrixTable } from './matrix-table'
import { MatrixFilters } from './matrix-filters'
import { formatDateIN, todayISO } from '@/lib/jmr/format'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

type SP = Promise<Record<string, string | string[] | undefined>>

export default async function JmrMatrixPage({ searchParams }: { searchParams: SP }) {
  await requirePermission('jmr', 'view')
  const sp = await searchParams
  const settings = await getJmrSettings()
  const supabase = await createClient()

  const projectId = (sp.project as string) || ''
  const contractorId = (sp.contractor as string) || ''
  const category = (sp.cat as 'equipment' | 'manpower' | 'both') || 'both'
  const dateFrom = (sp.from as string) || ''
  const dateTo = (sp.to as string) || todayISO()
  const subProjectIds = sp.sp
    ? (Array.isArray(sp.sp) ? sp.sp : [sp.sp])
    : null

  const [projectsRes, contractorsRes] = await Promise.all([
    supabase.from('projects').select('id, name, code').is('parent_project_id', null).order('name'),
    supabase.from('jmr_contractors').select('id, name').eq('status', 'active').order('name'),
  ])
  const projects = projectsRes.data ?? []
  const contractors = contractorsRes.data ?? []

  // If no project selected, default to first.
  const effectiveProjectId = projectId || projects[0]?.id || null

  let matrix = null
  let subProjectsAll: { id: string; name: string; code: string | null }[] = []
  if (effectiveProjectId) {
    const { data: subs } = await supabase
      .from('projects')
      .select('id, name, code')
      .eq('parent_project_id', effectiveProjectId)
      .order('name')
    subProjectsAll = subs ?? []

    matrix = await buildMatrix({
      projectId: effectiveProjectId,
      contractorId: contractorId || null,
      subProjectIds,
      category,
      dateFrom: dateFrom || null,
      dateTo,
      gstRatePct: settings.gst_rate_pct,
    })
  }

  const exportParams = new URLSearchParams({
    project: effectiveProjectId ?? '',
    ...(contractorId && { contractor: contractorId }),
    cat: category,
    to: dateTo,
    ...(dateFrom && { from: dateFrom }),
  })
  ;(subProjectIds ?? []).forEach(id => exportParams.append('sp', id))

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto">
      <PageHeader
        title={matrix?.project ? `${matrix.project.name} — JMR Summary` : 'JMR Matrix'}
        subtitle={`Equipment & manpower · cumulative ${dateFrom ? `from ${formatDateIN(dateFrom)} ` : ''}till ${formatDateIN(dateTo)}`}
        back="/jmr"
      >
        {matrix && (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/api/jmr/matrix-export/xlsx?${exportParams.toString()}`}>
                <FileSpreadsheet className="h-4 w-4" />Excel
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/api/jmr/matrix-export/pdf?${exportParams.toString()}`}>
                <FileText className="h-4 w-4" />PDF
              </Link>
            </Button>
          </>
        )}
      </PageHeader>

      <MatrixFilters
        projects={projects}
        contractors={contractors}
        subProjects={subProjectsAll}
        currentProjectId={effectiveProjectId ?? ''}
        currentContractorId={contractorId}
        currentCategory={category}
        currentDateFrom={dateFrom}
        currentDateTo={dateTo}
        currentSubProjectIds={subProjectIds ?? []}
      />

      {matrix ? (
        <Card className="overflow-hidden mt-4">
          <MatrixTable data={matrix} />
        </Card>
      ) : (
        <Card className="p-6 text-center text-sm text-gray-500 mt-4">
          Select a project to view its JMR matrix.
        </Card>
      )}
    </div>
  )
}
