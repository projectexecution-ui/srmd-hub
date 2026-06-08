import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Users, Settings, ShieldCheck, LayoutGrid, GitBranch, Trash2, Bell } from 'lucide-react'
import { getMyPermissions, can, isPortalOwner, getMyProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { isPendingAccessRequest, allowedEmailSet } from '@/lib/access-requests'

export const dynamic = 'force-dynamic'

export default async function AdminHomePage() {
  const [perms, portalOwner, profile] = await Promise.all([
    getMyPermissions(),
    isPortalOwner(),
    getMyProfile(),
  ])
  const canEditApprovals = portalOwner || profile?.role === 'admin'
  const canViewUsers = can(perms, 'admin-users', 'view')
  // Count of pending delete requests — small badge on the tile
  const supabase = await createClient()
  const { count: pendingDeleteCount } = canEditApprovals
    ? await supabase.from('delete_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    : { count: 0 }

  // Count of self-service access requests waiting on a decision — badge on Users.
  let pendingAccessCount = 0
  if (canViewUsers) {
    const [{ data: cand }, { data: allowedRows }, { data: adminEmailRow }] = await Promise.all([
      supabase.from('profiles').select('email, is_active, access_state').eq('is_active', false).is('access_state', null),
      supabase.from('allowed_emails').select('email'),
      supabase.from('app_settings').select('value').eq('key', 'admin_email').maybeSingle(),
    ])
    const allowedSet = allowedEmailSet(allowedRows ?? [])
    const adminEmail = (adminEmailRow?.value as string | null) ?? null
    pendingAccessCount = (cand ?? []).filter(p => isPendingAccessRequest(p, allowedSet, adminEmail)).length
  }

  const tiles = [
    { href: '/admin/users',       slug: 'admin-users',       icon: Users,       title: 'Users & Roles', sub: `Assign role per user, deactivate accounts${pendingAccessCount > 0 ? ` · ${pendingAccessCount} awaiting approval` : ''}.`, show: canViewUsers, badge: pendingAccessCount > 0 ? pendingAccessCount : null },
    { href: '/admin/permissions', slug: 'admin-permissions', icon: ShieldCheck, title: 'Permissions',   sub: 'Who can view / edit / admin / delete each module.',   show: can(perms, 'admin-permissions', 'view') },
    { href: '/admin/approvals',   slug: 'admin-approvals',   icon: GitBranch,   title: 'Approvals',     sub: 'Who approves what at each stage — across modules.', show: canEditApprovals },
    { href: '/admin/delete-requests', slug: 'admin-delete-requests', icon: Trash2, title: 'Delete Requests', sub: `Approve / reject pending deletes${pendingDeleteCount && pendingDeleteCount > 0 ? ` · ${pendingDeleteCount} waiting` : ''}.`, show: canEditApprovals, badge: pendingDeleteCount && pendingDeleteCount > 0 ? pendingDeleteCount : null },
    { href: '/admin/notifications', slug: 'admin-notifications', icon: Bell, title: 'Notifications', sub: 'Decide which alerts the team gets, by channel & role.', show: canEditApprovals },
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
              <Card className="p-5 hover:shadow-md transition-shadow relative">
                <t.icon className="h-6 w-6 text-slate-700 mb-3" />
                <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                  {t.title}
                  {'badge' in t && t.badge ? (
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold">
                      {t.badge}
                    </span>
                  ) : null}
                </h3>
                <p className="text-sm text-gray-500 mt-1">{t.sub}</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
