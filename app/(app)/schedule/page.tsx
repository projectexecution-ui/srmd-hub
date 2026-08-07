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
          {/* one collapsed row per PROJECT — 20 projects stay 20 calm rows; expand for its WOs */}
          {(() => {
            const groups = new Map<string, typeof wo.due>()
            for (const d of wo.due) { if (!groups.has(d.projectId)) groups.set(d.projectId, []); groups.get(d.projectId)!.push(d) }
            const sorted = [...groups.entries()].sort((a, b) => b[1][0].daysLate - a[1][0].daysLate)
            return sorted.map(([pid, list]) => {
              const worst = list[0]
              return (
                <details key={pid} className="border-t border-slate-100 group">
                  <summary className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-50 transition list-none [&::-webkit-details-marker]:hidden">
                    <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90 flex-shrink-0" />
                    <span className="inline-flex rounded-md bg-indigo-50 text-indigo-700 text-[11px] font-bold px-1.5 py-0.5 whitespace-nowrap">{worst.projectCode}</span>
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-800">{list.length} WO{list.length === 1 ? '' : 's'} pending</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap ${worst.daysLate > 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                      {worst.daysLate > 0 ? `worst ${worst.daysLate}d overdue` : `next by ${formatDate(worst.woBy)}`}
                    </span>
                  </summary>
                  <ul className="bg-slate-50/50 divide-y divide-slate-100">
                    {list.slice(0, 6).map(d => (
                      <li key={d.itemName} className="flex items-center gap-3 pl-11 pr-4 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-bold whitespace-nowrap ${d.daysLate > 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                          {d.daysLate > 0 ? `${d.daysLate}d overdue` : `by ${formatDate(d.woBy)}`}
                        </span>
                        <span className="flex-1 min-w-0 truncate text-[13px] text-slate-700">{d.itemName}<span className="text-slate-400"> · {d.trade}{d.contractor ? ` · 🏗️ ${d.contractor}` : ''}</span></span>
                      </li>
                    ))}
                    <li className="pl-11 pr-4 py-2">
                      <Link href={`/schedule/${pid}`} className="text-[12px] font-semibold text-indigo-600 hover:underline">
                        {list.length > 6 ? `All ${list.length} in ${worst.projectCode} →` : `Open ${worst.projectCode} →`}
                      </Link>
                    </li>
                  </ul>
                </details>
              )
            })
          })()}
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
