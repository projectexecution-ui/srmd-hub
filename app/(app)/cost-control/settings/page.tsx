import { requirePermission } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getCcSettings } from '@/lib/cost-control/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { CcSettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'
// The "Send me a test card" action renders a card + generates the Computed
// Working PDF + forwards the Excel & evidence, so give it room past the 10s default.
export const maxDuration = 60

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
  // card to (for rolling the feature out to approvers one by one). Read via the
  // SERVICE client: notification_preferences is RLS'd to auth.uid(), so the
  // session client would only ever see the admin's own row (this page is already
  // admin-gated above).
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const svc = svcUrl && svcKey ? createServiceClient(svcUrl, svcKey, { auth: { persistSession: false } }) : null
  const { data: connRows } = svc
    ? await svc.from('notification_preferences').select('user_id').eq('telegram', true).not('telegram_chat_id', 'is', null)
    : { data: [] as Array<{ user_id: string }> }
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
