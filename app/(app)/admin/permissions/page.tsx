import { createClient } from '@/lib/supabase/server'
import { requirePermission, isPortalOwner, getMyProfile } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { PageHeader } from '@/components/PageHeader'
import { MODULES } from '@/lib/modules'
import { type RolePermission, type Role } from '@/lib/types'
import PermissionsMatrix from './PermissionsMatrix'
import DeletePermissionsMatrix from './DeletePermissionsMatrix'

export const dynamic = 'force-dynamic'

export default async function AdminPermissionsPage() {
  await requirePermission('admin-permissions', 'admin')
  const supabase = await createClient()
  const [permsRes, rolesRes, roleLabels, currentUserIsPortalOwner, profile] = await Promise.all([
    supabase
      .from('role_permissions')
      .select('role, module_slug, can_view, can_edit, can_admin, delete_mode, delete_approver_role, updated_at, updated_by'),
    // Source roles live from role_labels so newly-added roles show up
    // immediately. is_active=false rows are soft-deleted and excluded.
    supabase
      .from('role_labels')
      .select('role, label, description, is_active')
      .order('role'),
    getRoleLabels(),
    isPortalOwner(),
    getMyProfile(),
  ])

  const activeRoles = (rolesRes.data ?? [])
    .filter(r => r.is_active !== false)
    .map(r => r.role as Role)

  const canManageRoles = currentUserIsPortalOwner || profile?.role === 'admin'

  // Module display names honour any rename done in /admin/dashboard-modules.
  const moduleLabels = await getModuleLabels()
  const moduleRefs = MODULES.map(m => ({ slug: m.slug, label: labelFor(moduleLabels, m.slug) }))

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Permissions"
        back="/admin"
        subtitle={
          currentUserIsPortalOwner
            ? 'Click any cell to toggle · click a role name in the header to rename it · use + to add a new role'
            : 'Who can do what in each module — toggle any cell and it saves instantly.'
        }
      />
      <PermissionsMatrix
        modules={moduleRefs}
        roles={activeRoles}
        initial={(permsRes.data ?? []) as RolePermission[]}
        roleLabels={roleLabels}
        currentUserIsPortalOwner={currentUserIsPortalOwner}
        canManageRoles={canManageRoles}
      />

      <DeletePermissionsMatrix
        modules={moduleRefs}
        roles={activeRoles}
        roleLabels={roleLabels}
        initial={(permsRes.data ?? []).map(r => ({
          role: r.role as Role,
          module_slug: r.module_slug,
          delete_mode: (r.delete_mode ?? 'none') as 'none' | 'direct' | 'request',
          delete_approver_role: r.delete_approver_role ?? null,
        }))}
      />
    </div>
  )
}
