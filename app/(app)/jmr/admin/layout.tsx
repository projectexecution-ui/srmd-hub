import Link from 'next/link'
import { ReactNode } from 'react'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'

const TABS = [
  { slug: 'contractors', label: 'Contractors', href: '/jmr/admin/contractors' },
  { slug: 'items',       label: 'Items',       href: '/jmr/admin/items' },
  { slug: 'rate-cards',  label: 'Rate Cards',  href: '/jmr/admin/rate-cards' },
  { slug: 'access',      label: 'User Access', href: '/jmr/admin/access' },
  { slug: 'settings',    label: 'Settings',    href: '/jmr/admin/settings' },
]

export default async function JmrAdminLayout({ children }: { children: ReactNode }) {
  await requirePermission('jmr-admin', 'view')
  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader title="JMR Admin" subtitle="Items, rate cards, contractors, access & settings" back="/jmr" />
      <div className="border-b border-gray-200 mb-4 overflow-x-auto">
        <nav className="flex gap-1 -mb-px min-w-max">
          {TABS.map(t => (
            <Link
              key={t.slug}
              href={t.href}
              className="px-4 py-2 text-sm font-medium text-gray-600 border-b-2 border-transparent hover:text-gray-900 hover:border-gray-300 aria-[current=page]:text-blue-700 aria-[current=page]:border-blue-600"
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      {children}
    </div>
  )
}
