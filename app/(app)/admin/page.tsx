import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { adminViewer } from '@/lib/admin/viewer'
import { visibleDoors, visibleTabs, tabHref, searchTabs } from '@/lib/admin/doors'
import { AdminSearch } from './AdminSearch'
import { ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Admin — the console's landing pane (Aksha, 23 Sep 2026, direction B). The
 * ribbon and the rail come from layout.tsx; this pane holds the search box
 * and, for a first visit, what each door is for. Pick a door on the left.
 */
export default async function AdminHomePage() {
  const v = await adminViewer()
  const doors = visibleDoors(v)

  if (doors.length === 0) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <PageHeader title="Admin" />
        <p className="text-sm text-gray-500 text-center py-12">You don&apos;t have admin access.</p>
      </div>
    )
  }

  const items = searchTabs('', v).map(h => ({ href: h.href, label: h.tab.label, hint: h.tab.hint, door: h.door.label }))

  return (
    <div className="space-y-4">
      <PageHeader title="Admin" subtitle="Everything you can change, behind five doors. Pick one on the left, or search." className="mb-0" />
      <AdminSearch items={items} />
      <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
        {doors.map(d => {
          const tabs = visibleTabs(d, v)
          return (
            <li key={d.id}>
              <Link href={tabHref(d, tabs[0].id)} className="flex items-start gap-3 px-4 py-3 min-h-[44px] hover:bg-gray-50">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">{d.label}</span>
                  <span className="block text-[12.5px] text-gray-500">{d.hint}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {tabs.map(t => <span key={t.id} className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">{t.label}</span>)}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 text-gray-300 flex-shrink-0 mt-1" />
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
