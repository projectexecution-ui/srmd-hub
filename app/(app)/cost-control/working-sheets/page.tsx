import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { WSStatusPill, type WSStatus } from '@/components/cost-control/WSStatusPill'
import { FileText, Plus } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const STATUS_FILTERS: Array<{ value: '' | WSStatus; label: string }> = [
  { value: '',          label: 'All' },
  { value: 'draft',     label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'approved',  label: 'Approved' },
  { value: 'returned',  label: 'Returned' },
]

export default async function WorkingSheetsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; status?: string; engineer?: string }>
}) {
  const perms = await requirePermission('cost-control', 'view')
  const canWrite = can(perms, 'cost-control', 'edit')
  const sp = await searchParams
  const supabase = await createClient()

  let q = supabase
    .from('cc_working_sheets')
    .select('id, ws_code, status, total_amount, created_at, engineer_id, project_id, sub_skill_id, projects(code, name), cc_disciplines(code, name), cc_sub_skills(code, name)')
    .order('created_at', { ascending: false })
    .limit(500)
  if (sp.project) q = q.eq('project_id', sp.project)
  if (sp.engineer) q = q.eq('engineer_id', sp.engineer)
  if (sp.status) q = q.eq('status', sp.status as WSStatus)

  const [wsRes, projectsRes, profilesRes] = await Promise.all([
    q,
    supabase.from('projects').select('id, code, name').not('cc_status', 'is', null).order('code'),
    supabase.from('profiles').select('id, full_name, name').eq('is_active', true),
  ])

  type WSRow = {
    id: string
    ws_code: string
    status: WSStatus
    total_amount: number | null
    created_at: string
    engineer_id: string
    project_id: string
    sub_skill_id: string
    projects: { code: string; name: string } | { code: string; name: string }[] | null
    cc_disciplines: { code: string; name: string } | { code: string; name: string }[] | null
    cc_sub_skills: { code: string; name: string } | { code: string; name: string }[] | null
  }
  const rows = (wsRes.data ?? []) as WSRow[]
  const projects = projectsRes.data ?? []
  type ProfileLite = { id: string; full_name: string | null; name: string | null }
  const profiles = (profilesRes.data ?? []) as ProfileLite[]
  const profileMap = new Map(profiles.map(p => [p.id, p.full_name ?? p.name ?? '(unnamed)']))

  const total = rows.reduce((s, r) => s + Number(r.total_amount ?? 0), 0)

  function buildQuery(params: Record<string, string | undefined>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '')
    if (entries.length === 0) return ''
    return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`).join('&')
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Working Sheets"
        subtitle={`${rows.length} sheet${rows.length === 1 ? '' : 's'} · ${formatINR(total)}`}
        back="/cost-control"
      >
        {canWrite && (
          <Button asChild size="sm">
            <Link href="/cost-control/working-sheets/new">
              <Plus className="h-4 w-4" /> New Working Sheet
            </Link>
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {STATUS_FILTERS.map(opt => (
          <Link
            key={opt.value || 'all'}
            href={`/cost-control/working-sheets${buildQuery({ ...sp, status: opt.value || undefined })}`}
            className={
              'inline-flex items-center px-3 h-8 rounded-full text-xs font-semibold transition-colors ' +
              ((sp.status ?? '') === opt.value ? 'bg-blue-600 text-white' : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50')
            }
          >
            {opt.label}
          </Link>
        ))}
        <form action="/cost-control/working-sheets" method="get" className="ml-auto flex items-center gap-2 flex-wrap">
          {sp.status && <input type="hidden" name="status" value={sp.status} />}
          <select
            name="project"
            defaultValue={sp.project ?? ''}
            className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700"
          >
            <option value="">All projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <select
            name="engineer"
            defaultValue={sp.engineer ?? ''}
            className="h-8 rounded-xl border border-gray-300 bg-white px-2 text-xs text-gray-700"
          >
            <option value="">All engineers</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.name ?? p.id}</option>)}
          </select>
          <button className="h-8 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700">
            Apply
          </button>
        </form>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-10 w-10" />}
            title="No Working Sheets match these filters"
            description="Create the first one with the button at the top right."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">WS Code</th>
                  <th className="px-4 py-3 font-semibold">Project</th>
                  <th className="px-4 py-3 font-semibold">Discipline · Sub-skill</th>
                  <th className="px-4 py-3 font-semibold">Engineer</th>
                  <th className="px-4 py-3 font-semibold text-right">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(w => {
                  const proj = Array.isArray(w.projects) ? w.projects[0] : w.projects
                  const dis = Array.isArray(w.cc_disciplines) ? w.cc_disciplines[0] : w.cc_disciplines
                  const sub = Array.isArray(w.cc_sub_skills) ? w.cc_sub_skills[0] : w.cc_sub_skills
                  return (
                    <tr key={w.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/cost-control/working-sheets/${w.id}`} className="font-semibold text-blue-700 hover:underline">
                          {w.ws_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{proj?.code ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-[260px]">
                        {dis?.code} · {sub?.name}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{profileMap.get(w.engineer_id) ?? '—'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900 text-right tabular-nums">{formatINR(w.total_amount ?? 0)}</td>
                      <td className="px-4 py-3"><WSStatusPill status={w.status} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(w.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
