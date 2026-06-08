import { createClient } from '@/lib/supabase/server'
import { requirePermission, can } from '@/lib/auth'
import { getRoleLabels } from '@/lib/role-labels'
import { Card } from '@/components/ui/card'
import { JmrRolesPanel } from './admins-panel'

export const dynamic = 'force-dynamic'

// "Who has what role inside JMR?" — independent from the hub-wide role.
//
// A user can be Backoffice globally but Head for JMR, or Engineer globally
// but Admin for JMR. We write the override to public.user_module_roles
// scoped to module_slug='jmr-admin' (the parent JMR admin module slug —
// other JMR sub-routes like /jmr/entry honour 'jmr' too, but for the
// admin-level powers it's 'jmr-admin').
//
// A "Block" picks user_module_blocks instead — useful if you have a global
// admin who you specifically do NOT want touching JMR.
export default async function JmrRolesPage() {
  const perms = await requirePermission('jmr-admin', 'admin')
  const canManage = can(perms, 'jmr-admin', 'admin')
  const supabase = await createClient()

  const [profilesRes, overridesRes, blocksRes, roleLabels] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, email, role, is_active')
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('user_module_roles')
      .select('user_id, module_slug, role')
      .eq('module_slug', 'jmr-admin'),
    supabase
      .from('user_module_blocks')
      .select('user_id, module_slug')
      .eq('module_slug', 'jmr-admin'),
    getRoleLabels(),
  ])

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-800">JMR Roles · per user</h2>
        <p className="text-xs text-gray-500 mt-1">
          Decide what each user can do inside JMR <b>independently</b> of their hub-wide role.
          {' '}A Backoffice user can be a JMR <b>Admin</b>, an Engineer can stay an Engineer everywhere except JMR, etc.
          {' '}Pick &quot;Inherit&quot; to fall back to their hub role; pick &quot;Block&quot; to deny JMR access to a global admin.
        </p>
      </div>
      <JmrRolesPanel
        profiles={profilesRes.data ?? []}
        overrides={overridesRes.data ?? []}
        blocks={blocksRes.data ?? []}
        roleLabels={roleLabels}
        canManage={canManage}
      />
    </Card>
  )
}
