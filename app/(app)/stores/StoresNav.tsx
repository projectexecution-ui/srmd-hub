'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/stores',             label: 'Overview' },
  { href: '/stores/gate',        label: 'Gate register' },
  { href: '/stores/requests',    label: 'Requests' },
  { href: '/stores/stock',       label: 'Stock' },
  { href: '/stores/returnables', label: 'To return' },
  { href: '/stores/reports',     label: 'Reports' },
  { href: '/stores/masters',     label: 'Masters' },
]

/** One row, scrollable on a phone rather than wrapping into three lines. */
export function StoresNav() {
  const path = usePathname()
  return (
    <nav className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="flex gap-1.5 border-b border-gray-200 min-w-max">
        {TABS.map(t => {
          // Longest match wins, so /stores/gate does not also light Overview.
          const active = t.href === '/stores' ? path === '/stores' : path.startsWith(t.href)
          return (
            <Link
              key={t.href} href={t.href}
              className={`px-3 py-2.5 text-[13px] font-semibold whitespace-nowrap min-h-[44px] flex items-center border-b-2 -mb-px ${
                active
                  ? 'border-indigo-700 text-indigo-800'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
