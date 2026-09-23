import Link from 'next/link'
import type { ReactNode } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { tabHref, type Door, type DoorTab } from '@/lib/admin/doors'

/**
 * One door of the Admin: the door's name, its tabs as a row of 44 px pills,
 * and the current tab's screen under them. Tabs are links (`?tab=`), so the
 * server renders only the screen asked for and every tab has an address that
 * can be bookmarked or sent.
 */
export function AdminDoor({ door, tabs, current, actions, children }: {
  door: Door
  tabs: DoorTab[]
  current: DoorTab
  /** Buttons for the header — "New project" on Projects. */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader title={door.label} back="/admin" subtitle={door.hint} className="mb-0">
        {actions}
      </PageHeader>
      {tabs.length > 1 && (
        <nav aria-label={`${door.label} sections`} className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map(t => {
            const on = t.id === current.id
            return (
              <Link
                key={t.id}
                href={tabHref(door, t.id)}
                aria-current={on ? 'page' : undefined}
                title={t.hint}
                className={`inline-flex items-center min-h-[44px] px-3.5 rounded-full border text-[13px] font-semibold whitespace-nowrap ${
                  on ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
      )}
      <p className="text-[12.5px] text-gray-500 -mt-1">{current.hint}.</p>
      {children}
    </div>
  )
}

/** The refusal for a door with nothing to show this person. Not a 404: the
 *  door exists; it simply holds nothing they may change. */
export function NothingHere({ door }: { door: Door }) {
  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader title={door.label} back="/admin" subtitle={door.hint} />
      <p className="mt-4 text-sm text-gray-500">Nothing here is yours to change. If it should be, ask an admin to widen your role on <Link href="/admin" className="text-indigo-700 hover:underline">Admin</Link>.</p>
    </div>
  )
}
