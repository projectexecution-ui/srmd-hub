import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { getScheduleProjects, getPortfolioWo } from '@/lib/schedule/data'
import { formatDate } from '@/lib/utils'
import { CalendarClock, ChevronRight, Wrench } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ScheduleHomePage() {
  await requirePermission('schedule', 'view')
  const [projects, wo] = await Promise.all([getScheduleProjects(), getPortfolioWo()])
  const overdue = wo.due.filter(d => d.daysLate > 0).length

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Schedule & WOs"
        subtitle="Pick a project to open its schedule — plan vs actual, Work-Order deadlines, drawings and floor-by-floor progress."
      />

      {/* One WO watch across ALL projects — no opening 20 schedules to check dates */}
      {(wo.due.length > 0 || wo.issuedRecent.length > 0) && (
        <Card className="p-0 shadow-sm overflow-hidden border-l-4 border-rose-400">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-rose-50/40 flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-bold text-slate-800 text-sm inline-flex items-center gap-1.5">
              <Wrench className="h-4 w-4 text-rose-500" /> Work Orders — all projects · {wo.due.length}
            </h3>
            <span className="text-[11px] text-slate-500">{overdue > 0 ? `${overdue} overdue` : 'next 2 weeks'}{wo.issuedRecent.length > 0 ? ` · ${wo.issuedRecent.length} issued in last 14 days` : ''}</span>
          </div>
          {wo.due.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {wo.due.slice(0, 10).map(d => (
                <li key={`${d.projectId}|${d.itemName}`}>
                  <Link href={`/schedule/${d.projectId}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${d.daysLate > 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                      {d.daysLate > 0 ? `${d.daysLate}d overdue` : `by ${formatDate(d.woBy)}`}
                    </span>
                    <span className="inline-flex rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-bold px-1.5 py-0.5 whitespace-nowrap">{d.projectCode}</span>
                    <span className="flex-1 min-w-0 truncate text-sm text-slate-800">{d.itemName}<span className="text-slate-400"> · {d.trade}{d.contractor ? ` · 🏗️ ${d.contractor}` : ''}</span></span>
                    <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                  </Link>
                </li>
              ))}
              {wo.due.length > 10 && <li className="px-4 py-2 text-[11px] text-slate-400">+{wo.due.length - 10} more inside their projects</li>}
            </ul>
          )}
        </Card>
      )}

      {projects.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">No projects found.</Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {projects.map(p => (
            <Link key={p.id} href={`/schedule/${p.id}`} className="block group">
              <Card className="p-4 flex items-center gap-3 group-hover:shadow-md group-hover:ring-1 group-hover:ring-indigo-200 transition">
                {p.item_count > 0 ? (
                  <span className="relative grid place-items-center flex-shrink-0" style={{ width: 44, height: 44, borderRadius: '50%', background: `conic-gradient(#4f46e5 ${p.pct}%, #e5ebf0 0)` }}>
                    <span className="absolute rounded-full bg-white" style={{ width: 32, height: 32 }} />
                    <span className="relative text-[11px] font-bold font-mono text-gray-800">{p.pct}%</span>
                  </span>
                ) : (
                  <span className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-700 grid place-items-center flex-shrink-0">
                    <CalendarClock className="h-5 w-5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900 truncate">
                    {p.code ? `${p.code} — ` : ''}{p.name}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    {p.item_count > 0 ? (
                      <>
                        <span className="text-xs text-gray-500">{p.pct}% done · {p.item_count} item{p.item_count === 1 ? '' : 's'}</span>
                        {p.attention > 0 && (
                          <span className="inline-flex items-center rounded-full bg-rose-50 text-rose-700 text-[11px] font-semibold px-2 py-0.5">{p.attention} need action</span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-gray-500">No schedule yet — open to build it</span>
                    )}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
