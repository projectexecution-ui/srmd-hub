import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getCcSettings } from '@/lib/cost-control/settings'
import { Card } from '@/components/ui/card'
import { CcSettingsForm } from './settings-form'

/**
 * Internal Estimate settings (G4: one name everywhere). Rendered by
 * /cost-control/settings and by Admin › Hub › Internal Estimate settings;
 * both gate it to cost-control admins before calling this.
 */
export async function InternalEstimateSettingsBody() {
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
  // session client would only ever see the admin's own row (the callers are
  // already admin-gated).
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const svc = svcUrl && svcKey ? createServiceClient(svcUrl, svcKey, { auth: { persistSession: false } }) : null
  const { data: connRows } = svc
    ? await svc.from('notification_preferences').select('user_id').eq('telegram', true).not('telegram_chat_id', 'is', null)
    : { data: [] as Array<{ user_id: string }> }
  const connectedIds = new Set((connRows ?? []).map(r => r.user_id as string))
  const connectedUsers = users.filter(u => connectedIds.has(u.id))

  return (
    <Card className="p-5">
      <CcSettingsForm initial={settings} users={users} connectedUsers={connectedUsers} />
    </Card>
  )
}
