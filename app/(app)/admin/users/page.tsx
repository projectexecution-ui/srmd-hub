import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser, isPortalOwner } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { getRoleSides } from '@/lib/role-sides'
import UsersClient from './UsersClient'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  await requirePermission('admin-users', 'admin')
  const [user, currentUserIsPortalOwner, roleLabels, roleSides] = await Promise.all([
    getMyUser(),
    isPortalOwner(),
    getRoleLabels(),
    getRoleSides(),
  ])
  const supabase = await createClient()

  const [
    { data: users },
    { data: allowed },
    { data: moduleRoles },
    { data: moduleBlocks },
    { data: adminEmailRow },
    { data: approvalRuleRows },
  ] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('allowed_emails').select('*').order('added_at', { ascending: false }),
    supabase.from('user_module_roles').select('*'),
    supabase.from('user_module_blocks').select('*'),
    supabase.from('app_settings').select('value').eq('key', 'admin_email').maybeSingle(),
    // Roles that actually sit on an active approval chain — the editor
    // warns when one of these is not marked Management.
    supabase.from('approval_rules').select('approver_role, override_role').eq('is_active', true),
  ])

  const approvalRoles = Array.from(new Set(
    (approvalRuleRows ?? []).flatMap(r => [r.approver_role, r.override_role]).filter((x): x is string => !!x),
  ))

  // UPPERCASE every role NAME (label) to match the Permissions Matrix standard —
  // "ATM HEAD", "CT HEAD", "SITE ENG", … no more mixed casing. Descriptions and
  // everything else are untouched. One place, so all dropdowns/badges stay in sync.
  const roleLabelsUpper = Object.fromEntries(
    Object.entries(roleLabels).map(([r, v]) => [r, { ...v, label: (v.label ?? r).toUpperCase() }]),
  ) as typeof roleLabels

  return (
    <UsersClient
      initialUsers={users ?? []}
      initialAllowedEmails={allowed ?? []}
      initialModuleRoles={moduleRoles ?? []}
      initialModuleBlocks={moduleBlocks ?? []}
      currentUserId={user!.id}
      currentUserIsPortalOwner={currentUserIsPortalOwner}
      roleLabels={roleLabelsUpper}
      adminEmail={(adminEmailRow?.value as string | null) ?? null}
      roleSides={roleSides}
      approvalRoles={approvalRoles}
    />
  )
}
