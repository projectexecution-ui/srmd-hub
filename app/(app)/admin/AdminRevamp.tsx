import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { ADMIN_AREAS, screensByArea, ADMIN_SCREENS } from '@/lib/revamp/admin-map'
import { Users, ShieldCheck, Library, Settings2 } from 'lucide-react'

const AREA_ICON = {
  people: Users,
  approvals: ShieldCheck,
  lists: Library,
  system: Settings2,
} as const

/**
 * The revamped Admin: 43 screens, four areas.
 *
 * Nothing is removed — an admin screen that disappears is a job somebody can
 * no longer do. What changes is that they are grouped and labelled by what
 * they are FOR, and each says which module it belongs to, so it is obvious
 * why it lives where it does. Before this, 34 of the 43 were only reachable
 * by already knowing they existed.
 */
export function AdminRevamp({ isAdmin }: { isAdmin: boolean }) {
  const visible = (s: { adminOnly?: boolean }) => isAdmin || !s.adminOnly

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader
        title="Admin"
        subtitle={`${ADMIN_SCREENS.filter(visible).length} settings screens, grouped by what they are for.`}
      />

      <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-4 py-3">
        <p className="text-xs text-gray-600">
          Most of these live inside a module rather than here — JMR alone has more settings screens than
          the whole portal admin. They are listed together so you can find one without knowing which
          module hid it.
        </p>
      </div>

      {ADMIN_AREAS.map(area => {
        const screens = screensByArea(area.id).filter(visible)
        if (screens.length === 0) return null
        const Icon = AREA_ICON[area.id]

        return (
          <section key={area.id}>
            <header className="flex items-baseline gap-2 mb-2 flex-wrap">
              <h2 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                <Icon className="h-4 w-4 text-gray-400" />
                {area.label}
              </h2>
              <span className="text-[11px] text-gray-400">{area.hint}</span>
              <span className="ml-auto text-[11px] text-gray-400 tabular-nums">{screens.length}</span>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {screens.map(s => (
                <Link
                  key={s.href}
                  href={s.href}
                  className="rounded-lg border border-gray-200 bg-white p-3 hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors min-h-[44px] block"
                >
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-900">{s.label}</span>
                    {s.module && (
                      <span className="text-[10px] font-mono text-gray-400 flex-shrink-0">{s.module}</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.hint}</p>
                </Link>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
