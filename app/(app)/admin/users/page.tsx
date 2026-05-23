import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyUser, isPortalOwner } from '@/lib/auth'
import UsersClient from './UsersClient'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  await requirePermission('admin-users', 'admin')
  const [user, currentUserIsPortalOwner] = await Promise.all([
    getMyUser(),
    isPortalOwner(),
  ])
  const supabase = await createClient()

  const { data: users } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })

  return (
    <UsersClient
      initialUsers={users ?? []}
      currentUserId={user!.id}
      currentUserIsPortalOwner={currentUserIsPortalOwner}
    />
  )
}
