import type { ReactNode } from 'react'
import { adminViewer } from '@/lib/admin/viewer'
import { visibleDoors, visibleTabs, tabHref } from '@/lib/admin/doors'
import { loadTodayBundle } from '@/lib/admin/today.server'
import { railBadge, foldToday } from '@/lib/admin/rail'
import { Rail, TodayRibbon, type RailDoor } from './Console'

/**
 * The Admin console (Aksha, 23 Sep 2026, direction B): a Today ribbon folded to
 * one line, a rail of the five doors with a live count and status dot each,
 * and the chosen door in the pane. Every /admin page renders inside it, so
 * moving between People, Projects and Messages never goes back to a home.
 *
 * Somebody with no door at all gets the page alone — /admin says so.
 */
export default async function AdminConsoleLayout({ children }: { children: ReactNode }) {
  const v = await adminViewer()
  const doors = visibleDoors(v)
  if (doors.length === 0) return <>{children}</>

  const bundle = v.settingsView ? await loadTodayBundle({ admin: v.admin }) : null
  const railDoors: RailDoor[] = doors.map(d => ({
    id: d.id,
    href: tabHref(d, visibleTabs(d, v)[0].id),
    label: d.label,
    badge: bundle ? railBadge(d.id, bundle.counts) : { text: '', tone: 'none' as const },
  }))

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {bundle && <TodayRibbon rows={bundle.rows} folded={foldToday(bundle.rows)} />}
      <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6 space-y-4 lg:space-y-0">
        <Rail doors={railDoors} />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
