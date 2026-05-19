import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Users } from 'lucide-react'
import { UserRow } from './user-row'

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/dashboard')

  const { data: users } = await supabase
    .from('profiles')
    .select('id, email, name, full_name, role, is_active, created_at')
    .order('created_at', { ascending: false })

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <PageHeader title="Users & Roles" back="/admin" subtitle={`${users?.length ?? 0} user${users?.length === 1 ? '' : 's'}`} />
      <Card className="overflow-hidden">
        {users && users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Active</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => <UserRow key={u.id} user={u} isSelf={u.id === user.id} />)}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={<Users className="h-10 w-10" />} title="No users yet" />
        )}
      </Card>
    </div>
  )
}
