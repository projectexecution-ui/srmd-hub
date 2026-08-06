import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { getScheduleProjects } from '@/lib/schedule/data'
import { CalendarClock, ChevronRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function ScheduleHomePage() {
  await requirePermission('schedule', 'view')
  const projects = await getScheduleProjects()

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Schedule & WOs"
        subtitle="Pick a project to open its schedule — plan vs actual, Work-Order deadlines, drawings and floor-by-floor progress."
      />

      {projects.length === 0 ? (
        <Card className="p-8 text-center text-gray-500">No projects found.</Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {projects.map(p => (
            <Link key={p.id} href={`/schedule/${p.id}`} className="block group">
              <Card className="p-4 flex items-center gap-3 group-hover:shadow-md group-hover:ring-1 group-hover:ring-indigo-200 transition">
                <span className="h-10 w-10 rounded-xl bg-indigo-50 text-indigo-700 grid place-items-center flex-shrink-0">
                  <CalendarClock className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900 truncate">
                    {p.code ? `${p.code} — ` : ''}{p.name}
                  </span>
                  <span className="block text-xs text-gray-500">
                    {p.item_count > 0
                      ? `${p.item_count} work item${p.item_count === 1 ? '' : 's'}`
                      : 'No schedule yet — open to build it'}
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
