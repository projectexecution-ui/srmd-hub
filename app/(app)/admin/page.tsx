import Link from 'next/link'
import type { ComponentType } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { adminViewer } from '@/lib/admin/viewer'
import { visibleDoors, visibleTabs, tabHref, searchTabs, type DoorId } from '@/lib/admin/doors'
import { loadToday } from '@/lib/admin/today.server'
import type { TodayRow } from '@/lib/admin/today'
import { AdminSearch } from './AdminSearch'
import { Users, Building2, Mail, Database, Settings2, ArrowRight } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Admin — one strip and five doors (Aksha, 23 Sep 2026, decision A1).
 *
 *   Today   — what is wrong right now, one sentence and one button each,
 *             read from the actual run log (lib/admin/today.ts).
 *   Doors   — People · Projects · Messages · Data · Hub, each with its tabs
 *             listed on the card so nothing is more than one tap away.
 *   Search  — for anyone who knows a screen's name.
 *
 * Nothing else: no fold, no A–Z, no job checklists, no "Old screens". The
 * same home shows whichever sidebar is on (F1) — lib/admin/doors.ts is the
 * one list, and every old address redirects into a door.
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

  const today = v.settingsView ? await loadToday({ admin: v.admin }) : []
  const items = searchTabs('', v).map(h => ({ href: h.href, label: h.tab.label, hint: h.tab.hint, door: h.door.label }))

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader title="Admin" subtitle="Everything you can change, behind five doors." />
      <AdminSearch items={items} />
      {v.settingsView && <Today rows={today} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" role="list" aria-label="Doors">
        {doors.map(d => {
          const tabs = visibleTabs(d, v)
          const Icon = ICON[d.id]
          return (
            <div role="listitem" key={d.id} className="rounded-2xl border border-gray-200 bg-white p-4 flex flex-col gap-2 hover:border-indigo-300">
              <Link href={tabHref(d, tabs[0].id)} className="group flex items-start gap-3 min-h-[44px]">
                <span className="h-9 w-9 rounded-xl border border-gray-200 bg-gray-50 grid place-items-center flex-shrink-0 group-hover:bg-white"><Icon className="h-[18px] w-[18px] text-gray-600" /></span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-gray-900 group-hover:underline">{d.label}</span>
                  <span className="block text-[13px] text-gray-600 leading-snug">{d.hint}</span>
                </span>
              </Link>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {tabs.map(t => (
                  <li key={t.id}>
                    <Link href={tabHref(d, t.id)} title={t.hint} className="inline-flex items-center min-h-[32px] px-2.5 rounded-full border border-gray-200 bg-gray-50 text-[12px] font-medium text-gray-700 hover:bg-white hover:border-indigo-300">
                      {t.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ICON: Record<DoorId, ComponentType<{ className?: string }>> = {
  people: Users, projects: Building2, messages: Mail, data: Database, hub: Settings2,
}

function Today({ rows }: { rows: TodayRow[] }) {
  if (rows.length === 0) {
    return (
      <section aria-label="Today" className="rounded-r-xl border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3">
        <p className="text-sm text-emerald-900">Nothing needs you today. Every feed ran, every job is recorded, nobody is waiting for access.</p>
      </section>
    )
  }
  const worst = rows[0].tone
  const rail = worst === 'bad' ? 'border-rose-500 bg-rose-50 divide-rose-200/70' : worst === 'warn' ? 'border-amber-500 bg-amber-50 divide-amber-200/70' : 'border-gray-300 bg-gray-50 divide-gray-200'
  return (
    <section aria-label="Today" className={`rounded-r-xl border-l-4 px-4 py-2 divide-y ${rail}`}>
      {rows.map(r => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
          <p className={`text-sm min-w-0 flex-1 ${r.tone === 'bad' ? 'text-rose-950' : r.tone === 'warn' ? 'text-amber-950' : 'text-gray-700'}`}>{r.text}</p>
          <Link href={r.href} className={`inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-[13px] font-semibold min-h-[36px] hover:bg-gray-50 ${r.tone === 'bad' ? 'border-rose-300 text-rose-900' : r.tone === 'warn' ? 'border-amber-300 text-amber-900' : 'border-gray-300 text-gray-800'}`}>
            {r.action} <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ))}
    </section>
  )
}
