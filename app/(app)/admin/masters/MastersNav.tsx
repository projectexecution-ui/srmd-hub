'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Sub-navigation across the Masters screens. Masters is a place you browse,
 *  not a page you visit once, so the set stays in reach on every screen. */
const MASTERS = [
  { href: '/admin/masters', label: 'Overview' },
  { href: '/admin/masters/contacts', label: 'Contacts' },
  { href: '/admin/masters/items', label: 'Items' },
  { href: '/admin/masters/stores', label: 'Stores' },
  { href: '/admin/masters/trusts', label: 'Trusts' },
  { href: '/admin/masters/projects', label: 'Projects' },
  { href: '/admin/masters/categories', label: 'Work categories' },
  { href: '/admin/masters/mapping', label: 'Name mapping' },
] as const

export function MastersNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Masters" className="flex gap-1 overflow-x-auto border-b border-gray-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {MASTERS.map(m => {
        const active = m.href === '/admin/masters' ? pathname === '/admin/masters' : pathname.startsWith(m.href)
        return (
          <Link key={m.href} href={m.href} aria-current={active ? 'page' : undefined}
            className={['relative whitespace-nowrap px-3 py-2.5 text-sm min-h-[44px] flex items-center transition-colors', active ? 'font-semibold text-indigo-800' : 'text-gray-600 hover:text-gray-900'].join(' ')}>
            {m.label}
            {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-indigo-700" />}
          </Link>
        )
      })}
    </nav>
  )
}
