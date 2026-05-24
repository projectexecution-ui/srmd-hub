import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Users, Settings, ShieldCheck, LayoutGrid, GitBranch } from 'lucide-react'
import { getMyPermissions, can, isPortalOwner, getMyProfile } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function AdminHomePage() {
  const [perms, portalOwner, profile] = await Promise.all([
    getMyPermissions(),
    isPortalOwner(),
    getMyProfile(),
  ])
  const canEditApprovals = portalOwner || profile?.role === 'admin'
  const tiles = [
    { href: '/admin/users',       slug: 'admin-users',       icon: Users,       title: 'Users & Roles', sub: 'Assign role per user, deactivate accounts.', show: can(perms, 'admin-users', 'view') },
    { href: '/admin/permissions', slug: 'admin-permissions', icon: ShieldCheck, title: 'Permissions',   sub: 'Who can view / edit / admin each module.',   show: can(perms, 'admin-permissions', 'view') },
    { href: '/admin/approvals',   slug: 'admin-approvals',   icon: GitBranch,   title: 'Approvals',     sub: 'Who approves what at each stage — across modules.', show: canEditApprovals },
    { href: '/admin/dashboard-modules', slug: 'dashboard-modules', icon: LayoutGrid, title: 'Dashboard Modules', sub: 'Turn modules on / off for the portal.',     show: portalOwner },
    { href: '/admin/settings',    slug: 'admin-settings',    icon: Settings,    title: 'Settings',      sub: 'Admin email, etc.',                          show: can(perms, 'admin-settings', 'view') },
  ].filter(t => t.show)

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader title="Admin" subtitle="App configuration" />
      {tiles.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-12">You don&apos;t have admin access.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tiles.map(t => (
            <Link key={t.href} href={t.href}>
              <Card className="p-5 hover:shadow-md transition-shadow">
                <t.icon className="h-6 w-6 text-slate-700 mb-3" />
                <h3 className="font-semibold text-gray-900">{t.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{t.sub}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
