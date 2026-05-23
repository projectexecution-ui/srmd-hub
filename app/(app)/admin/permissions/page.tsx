import { createClient } from '@/lib/supabase/server'
import { requirePermission, isPortalOwner } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { PageHeader } from '@/components/PageHeader'
import { MODULES } from '@/lib/modules'
import { ALL_ROLES, type RolePermission } from '@/lib/types'
import PermissionsMatrix from './PermissionsMatrix'

export const dynamic = 'force-dynamic'

export default async function AdminPermissionsPage() {
  await requirePermission('admin-permissions', 'admin')
  const supabase = await createClient()
  const [permsRes, roleLabels, currentUserIsPortalOwner] = await Promise.all([
    supabase
      .from('role_permissions')
      .select('role, module_slug, can_view, can_edit, can_admin, updated_at, updated_by'),
    getRoleLabels(),
    isPortalOwner(),
  ])

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Permissions"
        back="/admin"
        subtitle={
          currentUserIsPortalOwner
            ? 'Click any cell to toggle · click a role name in the header to rename it'
            : 'Who can do what in each module — toggle any cell and it saves instantly.'
        }
      />
      <PermissionsMatrix
        modules={MODULES.map(m => ({ slug: m.slug, label: m.label }))}
        roles={ALL_ROLES}
        initial={(permsRes.data ?? []) as RolePermission[]}
        roleLabels={roleLabels}
        currentUserIsPortalOwner={currentUserIsPortalOwner}
      />
    </div>
  )
}
