import { createClient } from '@/lib/supabase/server'
import { isPortalOwner, getMyProfile } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { buildMatrixSections } from '@/lib/revamp/permissions'
import { type Role } from '@/lib/types'
import PermissionsBoard from './PermissionsBoard'
import type { PermRow } from './PermissionsMatrix'

/**
 * Roles & powers — the People door's third tab (C1). The matrix built from the
 * revamp's own registry: every tab of the ribbon and, under each, every pill,
 * each with a switch per role (ws:<tab>, ws:<tab>:<pill> in role_permissions);
 * then the POWERS — what a role can do. The gate is the door's.
 */
export async function RolesBody() {
  const supabase = await createClient()
  const [permsRes, rolesRes, roleLabels, currentUserIsPortalOwner, profile] = await Promise.all([
    supabase
      .from('role_permissions')
      .select('role, module_slug, can_view, can_edit, can_admin, delete_mode, delete_approver_role, updated_at, updated_by'),
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
  const { sections } = buildMatrixSections()

  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-gray-500">
        {currentUserIsPortalOwner
          ? 'Toggle any cell and it saves instantly · click a role name to rename it · + adds a role.'
          : 'Toggle any cell and it saves instantly.'}
      </p>
      <PermissionsBoard
        sections={sections}
        roles={activeRoles}
        roleLabels={roleLabels}
        currentUserIsPortalOwner={currentUserIsPortalOwner}
        canManageRoles={canManageRoles}
        accessInitial={(permsRes.data ?? []) as unknown as PermRow[]}
      />
    </div>
  )
}
