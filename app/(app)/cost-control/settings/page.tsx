import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getCcSettings } from '@/lib/cost-control/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { CcSettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function CostControlSettingsPage() {
  await requirePermission('cost-control', 'admin')
  const settings = await getCcSettings()

  // Active users for the "who can archive" grant picker.
  const supabase = await createClient()
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, name, role')
    .eq('is_active', true)
    .order('full_name')
  const users = (profiles ?? []).map(p => ({
    id: p.id as string,
    name: (p.full_name ?? p.name ?? '(unnamed)') as string,
    role: (p.role ?? '') as string,
  }))

  // Teammates who have connected Telegram — the ones we can send a test approval
  // card to (for rolling the feature out to approvers one by one).
  const { data: connRows } = await supabase
    .from('notification_preferences')
    .select('user_id')
    .eq('telegram', true)
    .not('telegram_chat_id', 'is', null)
  const connectedIds = new Set((connRows ?? []).map(r => r.user_id as string))
  const connectedUsers = users.filter(u => connectedIds.has(u.id))

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="Cost Control — Settings"
        subtitle="Switch features on or off and rename the approval fields. Changes apply to everyone the next time a page loads."
        back="/cost-control"
      />
      <Card className="p-5">
        <CcSettingsForm initial={settings} users={users} connectedUsers={connectedUsers} />
      </Card>
    </div>
  )
}
