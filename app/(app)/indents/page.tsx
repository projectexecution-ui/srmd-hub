import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { IndentStagePill } from '@/components/IndentStagePill'
import { ClipboardList, ExternalLink } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import type { IndentStage } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STAGE_OPTIONS: Array<{ value: '' | IndentStage; label: string }> = [
  { value: '', label: 'All stages' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'verify', label: 'Verify' },
  { value: 'approved', label: 'Approved' },
]

export default async function IndentsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; stage?: string; q?: string }>
}) {
  await requirePermission('indents', 'view')
  const sp = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('indents')
    .select('id, indent_no, indent_date, stage, sub_project, area_of_application, notes, projects(id, code, name), indent_lines(count)')
    .order('indent_date', { ascending: false })
    .limit(500)

  if (sp.project) query = query.eq('project_id', sp.project)
  if (sp.stage) query = query.eq('stage', sp.stage as IndentStage)
  if (sp.q) query = query.ilike('indent_no', `%${sp.q}%`)

  const [indentsRes, projectsRes] = await Promise.all([
    query,
    supabase.from('projects').select('id, code, name').order('code'),
  ])

  type IndentRow = {
    id: string
    indent_no: string
    indent_date: string
    stage: IndentStage
    sub_project: string | null
    area_of_application: string | null
    notes: string | null
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    indent_lines: { count: number }[]
  }

  const indents = (indentsRes.data ?? []) as IndentRow[]
  const projects = projectsRes.data ?? []
  const totalLines = indents.reduce((s, i) => s + (i.indent_lines?.[0]?.count ?? 0), 0)

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Indents"
        subtitle={`${indents.length} indent${indents.length === 1 ? '' : 's'} · ${totalLines} line${totalLines === 1 ? '' : 's'}`}
      >
        <Link
          href="/indent-tracker.html"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 px-3 h-8 rounded-md hover:bg-gray-100"
          title="Legacy offline tracker — drop your Excel for client-side viewing"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Offline tracker
        </Link>
      </PageHeader>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {STAGE_OPTIONS.map(opt => (
          <FilterChip
            key={opt.value || 'all'}
            href={`/indents${buildQuery({ ...sp, stage: opt.value || undefined })}`}
            label={opt.label}
            active={(sp.stage ?? '') === opt.value}
          />
        ))}
        <form action="/indents" method="get" className="w-full sm:w-auto sm:ml-auto flex items-center gap-2 flex-wrap">
          {sp.stage && <input type="hidden" name="stage" value={sp.stage} />}
          <input
            type="search"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Indent no…"
            className="h-8 rounded-xl border border-gray-300 bg-white px-3 text-xs text-gray-700 w-full sm:w-[150px] min-w-0"
          />
          <select
            name="project"
            defaultValue={sp.project ?? ''}
            className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700 w-full sm:w-auto min-w-0"
          >
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <button className="h-8 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 w-full sm:w-auto">
            Apply
          </button>
        </form>
      </div>

      <Card className="overflow-hidden">
        {indents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Indent No.</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Sub-project</th>
                  <th className="px-4 py-3 font-semibold">Area</th>
                  <th className="px-4 py-3 font-semibold text-right">Lines</th>
                  <th className="px-4 py-3 font-semibold">Stage</th>
                </tr>
              </thead>
              <tbody>
                {indents.map(i => {
                  const proj = Array.isArray(i.projects) ? i.projects[0] : i.projects
                  return (
                    <tr key={i.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/indents/${i.id}`} className="font-semibold text-blue-700 hover:underline">
                          {i.indent_no}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(i.indent_date)}</td>
                      <td className="px-4 py-3 text-gray-700">{proj?.code || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate">{i.sub_project || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[260px] truncate">{i.area_of_application || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 text-right tabular-nums">{i.indent_lines?.[0]?.count ?? 0}</td>
                      <td className="px-4 py-3"><IndentStagePill stage={i.stage} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<ClipboardList className="h-10 w-10" />}
            title="No indents match these filters"
            description="Try clearing the stage or project filter, or use the offline tracker in the top right."
          />
        )}
      </Card>
    </div>
  )
}

function buildQuery(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
  if (entries.length === 0) return ''
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`).join('&')
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        'inline-flex items-center px-3 h-8 rounded-full text-xs font-semibold transition-colors ' +
        (active ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50')
      }
    >
      {label}
    </Link>
  )
}
