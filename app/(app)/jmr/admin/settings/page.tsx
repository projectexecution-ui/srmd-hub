import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/card'
import { getJmrSettings } from '@/lib/jmr/settings'
import { SettingsForm, type RecipientUser } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function JmrSettingsPage() {
  await requirePermission('jmr-admin', 'edit')
  const settings = await getJmrSettings()

  // Weekly-report recipients are chosen from the hub's own users (no typing
  // raw emails). Active accounts that actually have an email address.
  const supabase = await createClient()
  const { data: profs } = await supabase
    .from('profiles')
    .select('id, full_name, name, email, role, is_active')
    .or('is_active.is.null,is_active.eq.true')
    .order('role')

  const users: RecipientUser[] = ((profs ?? []) as Array<{
    full_name: string | null; name: string | null; email: string | null; role: string | null
  }>)
    .filter(p => !!p.email)
    .map(p => ({
      email: p.email as string,
      name: p.full_name ?? p.name ?? (p.email as string),
      role: p.role ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Card className="p-4">
      <h2 className="text-lg font-bold mb-1">Settings</h2>
      <p className="text-xs text-gray-500 mb-4">GST rate and the weekly report (day &amp; recipients).</p>
      <SettingsForm initial={settings} users={users} />
    </Card>
  )
}
