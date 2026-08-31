'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Sub-navigation across the Masters screens.
 *
 * Without it, moving from Contacts to Items meant going back to the landing
 * page first — six screens with no way between them. Masters is a place you
 * browse, not a page you visit once, so the set should always be in reach.
 */
const MASTERS = [
  { href: '/masters', label: 'Overview' },
  { href: '/masters/mapping', label: 'Name mapping' },
  { href: '/masters/contacts', label: 'Contacts' },
  { href: '/masters/items', label: 'Items' },
  { href: '/masters/stores', label: 'Stores' },
  { href: '/masters/trusts', label: 'Trusts' },
  { href: '/masters/projects', label: 'Projects' },
] as const

export function MastersNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Masters"
      className="flex gap-1 overflow-x-auto border-b border-gray-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {MASTERS.map(m => {
        // Exact match for the index, prefix for the rest, so /masters is not
        // lit on every child page.
        const active = m.href === '/masters' ? pathname === '/masters' : pathname.startsWith(m.href)
        return (
          <Link
            key={m.href}
            href={m.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'relative whitespace-nowrap px-3 py-2.5 text-sm min-h-[44px] flex items-center transition-colors',
              active ? 'font-semibold text-indigo-800' : 'text-gray-600 hover:text-gray-900',
            ].join(' ')}
          >
            {m.label}
            {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-indigo-700" />}
          </Link>
        )
      })}
    </nav>
  )
}
