import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { AdminsPanel } from './admins-panel'

export const dynamic = 'force-dynamic'

// "Who is a JMR admin?" lives here so an existing JMR admin can grant
// another user JMR-admin access without leaving the module.
//
// The DB plumbing already exists: public.user_module_roles is a
// per-user-per-module role override. We write `(user_id, 'jmr-admin', 'admin')`
// to promote, delete the row to revoke. The user's global profiles.role
// is untouched.
//
// Why only role='admin'? Per role_permissions, that's the only role with
// can_admin=true on the jmr-admin module. `head` has edit but not admin;
// if you want to give someone edit-only access, use the global /admin/users
// page — this panel is the focused "is/isn't a JMR admin" toggle.
export default async function JmrAdminsPage() {
  const perms = await requirePermission('jmr-admin', 'admin')
  const canManage = can(perms, 'jmr-admin', 'admin')
  const supabase = await createClient()

  const [profilesRes, overridesRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('user_module_roles')
      .select('user_id, module_slug, role')
      .eq('module_slug', 'jmr-admin'),
  ])

  const profiles = profilesRes.data ?? []
  const overrides = overridesRes.data ?? []

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-800">JMR Admins</h2>
        <p className="text-xs text-gray-500 mt-1">
          A JMR Admin can manage Projects, Contractors, Items, Rate Cards, User Access and Settings — and approve / flag any engineer&apos;s entry.
          {' '}Global Admins (left column) are auto-JMR-admin; demote them under <span className="font-mono">Admin → Users</span> if needed.
        </p>
      </div>
      <AdminsPanel
        profiles={profiles}
        overrides={overrides}
        canManage={canManage}
      />
    </Card>
  )
}
