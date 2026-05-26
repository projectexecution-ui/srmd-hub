import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser, isPortalOwner } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import UsersClient from './UsersClient'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  await requirePermission('admin-users', 'admin')
  const [user, currentUserIsPortalOwner, roleLabels] = await Promise.all([
    getMyUser(),
    isPortalOwner(),
    getRoleLabels(),
  ])
  const supabase = await createClient()

  const [{ data: users }, { data: allowed }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    supabase.from('allowed_emails').select('*').order('added_at', { ascending: false }),
  ])

  return (
    <UsersClient
      initialUsers={users ?? []}
      initialAllowedEmails={allowed ?? []}
      currentUserId={user!.id}
      currentUserIsPortalOwner={currentUserIsPortalOwner}
      roleLabels={roleLabels}
    />
  )
}
