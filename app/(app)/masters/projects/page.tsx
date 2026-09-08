import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { RowDetailProvider, RowDetailToggle, RowDetail } from '@/components/cost-control/project-tree'
import { loadProjectMaster, type MainProject } from '@/lib/revamp/masters-in4'
import { formatDate } from '@/lib/utils'
import { In4Note } from '../In4Note'

export const dynamic = 'force-dynamic'

/**
 * Project Master — IN4's projects and sub-projects (NGH → NGH A-Execution,
 * NGH B-Execution, NGH B-Design …) with start and end dates, the paying
 * trust, the site address, IN4's own status, work orders counted against
 * each, and which CT Hub project the sub-project feeds. Sub-projects open
 * under their project; collapsed until asked for.
 */
export default async function ProjectsMasterPage() {
  await requirePermission('cost-control', 'view')
  const { projects, in4, in4Error } = await loadProjectMaster()
  const subs = projects.reduce((t, p) => t + p.subs.length, 0)
  const active = projects.reduce((t, p) => t + p.subs.filter(x => x.isActive).length, 0)
  const wos = projects.reduce((t, p) => t + p.workOrders, 0)
  const linked = projects.filter(p => p.hubProjects.length > 0).length

  return (
    <RowDetailProvider>
      <div className="space-y-4">
        <PageHeader
          title="Project Master"
          subtitle="Main projects and their sub-projects, as IN4 holds them — dates, paying trust, site address."
        />
        <In4Note in4={in4} error={in4Error} what="dates, addresses and status" />

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Kpi label="Main projects" value={projects.length} />
          <Kpi label="Sub-projects" value={subs} />
          <Kpi label="Active sub-projects" value={active} />
          <Kpi label="Work orders" value={wos} />
          <Kpi label="Linked to a CT Hub project" value={linked} />
        </div>

        <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100">
          {projects.map(p => <ProjectRow key={p.id} p={p} />)}
        </div>
      </div>
    </RowDetailProvider>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
      <p className="text-[12px] text-gray-500">{label}</p>
      <p className="text-[15px] font-semibold tabular-nums text-gray-900">{value.toLocaleString('en-IN')}</p>
    </div>
  )
}

const span = (a: string | null, b: string | null) =>
  a || b ? `${a ? formatDate(a) : '…'} → ${b ? formatDate(b) : '…'}` : null

function ProjectRow({ p }: { p: MainProject }) {
  const dates = span(p.start, p.end)
  return (
    <div id={`p-${p.id}`}>
      <div className="px-3 py-2 flex items-start gap-1 text-[13px]">
        <RowDetailToggle id={`proj:${p.id}`} count={p.subs.length} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 flex-wrap">
            {p.code && <span className="font-mono text-[12px] text-gray-500">{p.code}</span>}
            <span className="font-semibold text-gray-900">{p.name}</span>
            {p.trustCode && <span className="font-mono text-[11px] text-indigo-800 bg-indigo-50 border border-indigo-100 rounded px-1" title={p.trustName ?? undefined}>{p.trustCode}</span>}
            {p.status && p.status !== 'Approved' && <span className="text-[11px] rounded border border-amber-200 bg-amber-50 text-amber-800 px-1">{p.status}</span>}
          </p>
          <p className="text-[12px] text-gray-500 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {dates && <span>{dates}</span>}
            <span>{p.subs.length} sub-project{p.subs.length === 1 ? '' : 's'}</span>
            <span>{p.workOrders.toLocaleString('en-IN')} WO{p.workOrders === 1 ? '' : 's'}</span>
            {p.hubProjects.length > 0 && <span>CT Hub: {p.hubProjects.join(', ')}</span>}
          </p>
          {p.address && <p className="text-[12px] text-gray-600 mt-0.5">{p.address}{p.city || p.pin ? ` · ${[p.city, p.pin].filter(Boolean).join(' ')}` : ''}</p>}
        </div>
      </div>
      <RowDetail id={`proj:${p.id}`}>
        <ul className="bg-slate-50/60 border-t border-gray-100 divide-y divide-gray-100">
          {p.subs.map(x => {
            const d = span(x.start, x.end)
            return (
              <li key={x.id} className={`pl-10 pr-3 py-1.5 text-[12px] ${x.isActive ? '' : 'text-gray-400'}`}>
                <p className="flex items-center gap-2 flex-wrap">
                  {x.code && <span className="font-mono text-gray-500">{x.code}</span>}
                  <span className={x.isActive ? 'font-medium text-gray-900' : 'font-medium'}>{x.name}</span>
                  {!x.isActive && <span className="text-[11px] rounded border border-gray-300 px-1">inactive</span>}
                  {x.status && x.status !== 'Approved' && x.isActive && <span className="text-[11px] rounded border border-amber-200 bg-amber-50 text-amber-800 px-1">{x.status}</span>}
                  <span className="ml-auto tabular-nums text-gray-500">{x.workOrders.toLocaleString('en-IN')} WO{x.workOrders === 1 ? '' : 's'}</span>
                </p>
                <p className="text-gray-500 flex flex-wrap gap-x-3">
                  {d && <span>{d}</span>}
                  {x.hubProjects.length > 0 && <span>CT Hub: {x.hubProjects.join(', ')}</span>}
                </p>
              </li>
            )
          })}
          {p.subs.length === 0 && <li className="pl-10 pr-3 py-1.5 text-[12px] text-gray-500 italic">IN4 holds no sub-project under this project.</li>}
        </ul>
      </RowDetail>
    </div>
  )
}
