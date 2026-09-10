import { createClient } from '@/lib/supabase/server'
import { requirePermission, isPortalOwner, getMyProfile } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { PageHeader } from '@/components/PageHeader'
import { buildMatrixSections } from '@/lib/revamp/permissions'
import { type Role } from '@/lib/types'
import PermissionsBoard from './PermissionsBoard'
import type { PermRow } from './PermissionsMatrix'

export const dynamic = 'force-dynamic'

/**
 * Permissions — the revamp's matrix (Aksha, 10 Sep 2026).
 *
 * Built from the revamp's own registry and nothing else: every tab of the
 * ribbon and, under each, every pill, each with a switch of its own per role
 * (ws:<tab>, ws:<tab>:<pill> in role_permissions — no new table); then the
 * POWERS — what a role can do, named for what they power now. The old module
 * list (lib/modules.ts) is not imported here; when the old screens go after
 * approval, this page does not change.
 */
export default async function AdminPermissionsPage() {
  await requirePermission('admin-permissions', 'admin')
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
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Permissions"
        back="/admin"
        subtitle={
          currentUserIsPortalOwner
            ? 'Who may open each tab and pill of a project, and what each role can do · click a role name to rename it · + adds a role'
            : 'Who may open each tab and pill of a project, and what each role can do — toggle any cell and it saves instantly.'
        }
      />
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
