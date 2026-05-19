import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { IndentStagePill } from '@/components/IndentStagePill'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ClipboardList } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function IndentsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; project?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('indents')
    .select('id, indent_no, indent_date, stage, sub_project, raised_by, projects(code, name), indent_lines(count)')
    .order('indent_date', { ascending: false })
    .limit(200)

  if (sp.stage) query = query.eq('stage', sp.stage)
  if (sp.project) query = query.eq('project_id', sp.project)

  const { data: indents } = await query
  const { data: projects } = await supabase.from('projects').select('id, code, name').order('code')

  const stages = ['draft', 'submitted', 'verify', 'approved'] as const

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Indents"
        subtitle={`${indents?.length ?? 0} indent${indents?.length === 1 ? '' : 's'}`}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <FilterChip href="/indents" label="All" active={!sp.stage && !sp.project} />
        {stages.map(s => (
          <FilterChip
            key={s}
            href={`/indents?stage=${s}${sp.project ? `&project=${sp.project}` : ''}`}
            label={s.charAt(0).toUpperCase() + s.slice(1)}
            active={sp.stage === s}
          />
        ))}
        <div className="ml-auto">
          <ProjectFilter projects={projects ?? []} current={sp.project} stage={sp.stage} />
        </div>
      </div>

      <Card className="overflow-hidden">
        {indents && indents.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Indent No.</th>
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Sub-project</th>
                  <th className="px-4 py-3 font-semibold text-right">Lines</th>
                  <th className="px-4 py-3 font-semibold">Stage</th>
                </tr>
              </thead>
              <tbody>
                {indents.map((i: { id: string; indent_no: string; indent_date: string; stage: string; sub_project: string | null; projects: { code: string; name: string } | { code: string; name: string }[] | null; indent_lines: { count: number }[] }) => {
                  const proj = Array.isArray(i.projects) ? i.projects[0] : i.projects
                  const lineCount = i.indent_lines?.[0]?.count ?? 0
                  return (
                    <tr key={i.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/indents/${i.id}`} className="font-semibold text-blue-700 hover:underline">
                          {i.indent_no}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{formatDate(i.indent_date)}</td>
                      <td className="px-4 py-3 text-gray-700">{proj?.code || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-xs truncate">{i.sub_project || '—'}</td>
                      <td className="px-4 py-3 text-gray-700 text-right tabular-nums">{lineCount}</td>
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
            title="No indents found"
            description="Try clearing filters, or upload an Excel from the Uploads page."
          />
        )}
      </Card>
    </div>
  )
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        'inline-flex items-center px-3 h-8 rounded-full text-xs font-semibold transition-colors ' +
        (active
          ? 'bg-blue-600 text-white'
          : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50')
      }
    >
      {label}
    </Link>
  )
}

function ProjectFilter({
  projects, current, stage,
}: { projects: { id: string; code: string; name: string }[]; current?: string; stage?: string }) {
  // Server-rendered simple select (no JS needed). We render as a styled <form>.
  return (
    <form action="/indents" method="get" className="flex items-center gap-2">
      {stage && <input type="hidden" name="stage" value={stage} />}
      <label htmlFor="project" className="text-xs text-gray-500">Project</label>
      <select
        id="project"
        name="project"
        defaultValue={current ?? ''}
        className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700"
      >
        <option value="">All</option>
        {projects.map(p => (
          <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
        ))}
      </select>
      <button className="h-8 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700">Apply</button>
    </form>
  )
}
