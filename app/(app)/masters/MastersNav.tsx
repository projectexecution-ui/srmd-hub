'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'

/**
 * Sub-navigation across the Masters screens, in the order of Aksha's mind
 * map: Trust → Project → Contact → Budget Categories → Item → BOQ. The two
 * CT Hub housekeeping lists (stores, name mapping) follow, set apart, and a
 * search that looks in all six at once.
 *
 * Without it, moving from Contacts to Items meant going back to the landing
 * page first. Masters is a place you browse, not a page you visit once.
 */
const MASTERS = [
  { href: '/masters', label: 'Overview' },
  { href: '/masters/trusts', label: 'Trusts' },
  { href: '/masters/projects', label: 'Projects' },
  { href: '/masters/contacts', label: 'Contacts' },
  { href: '/masters/categories', label: 'Budget categories' },
  { href: '/masters/items', label: 'Items' },
  { href: '/masters/boq', label: 'BOQ' },
  { href: '/masters/rates', label: 'Rates' },
] as const
const HOUSEKEEPING = [
  { href: '/masters/stores', label: 'Stores' },
  { href: '/masters/mapping', label: 'Name mapping' },
  { href: '/masters/housekeeping', label: 'Housekeeping' },
] as const

export function MastersNav() {
  const pathname = usePathname()
  const item = (m: { href: string; label: string; icon?: React.ReactNode }) => {
    // Exact match for the index, prefix for the rest, so /masters is not
    // lit on every child page.
    const active = m.href === '/masters' ? pathname === '/masters' : pathname.startsWith(m.href)
    return (
      <Link
        key={m.href}
        href={m.href}
        aria-current={active ? 'page' : undefined}
        className={[
          'relative whitespace-nowrap px-3 py-2.5 text-sm min-h-[44px] flex items-center gap-1.5 transition-colors',
          active ? 'font-semibold text-indigo-800' : 'text-gray-600 hover:text-gray-900',
        ].join(' ')}
      >
        {m.icon}{m.label}
        {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-indigo-700" />}
      </Link>
    )
  }

  return (
    <nav
      aria-label="Masters"
      className="flex gap-1 overflow-x-auto border-b border-gray-200 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {MASTERS.map(item)}
      <span aria-hidden className="self-center mx-1 h-5 w-px bg-gray-200 flex-shrink-0" />
      {HOUSEKEEPING.map(item)}
      <span className="ml-auto flex-shrink-0">{item({ href: '/masters/search', label: 'Search', icon: <Search className="h-3.5 w-3.5" /> })}</span>
    </nav>
  )
}
