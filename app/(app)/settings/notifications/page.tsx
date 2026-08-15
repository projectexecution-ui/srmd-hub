// Per-user notification settings (/settings/notifications, opened from the
// bell's gear). Anyone can turn phone push on/off for their OWN device here —
// registering a device isn't a preference to gate. The detailed channel
// preferences show only to people the admin has granted self-management.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyProfile } from '@/lib/auth'
import { canManageOwnNotifications } from '@/lib/notifications/self-manage'
import { getRoleSides } from '@/lib/role-sides'
import type { Role } from '@/lib/types'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { Smartphone } from 'lucide-react'
import { NotificationPreferencesForm } from './preferences-form'
import { TelegramConnect } from './TelegramConnect'
import { ReportsGroupConnect } from './ReportsGroupConnect'
import { reportsGroupStatus } from './telegram-actions'
import { EnablePushButton } from '@/components/push/EnablePushButton'

export const dynamic = 'force-dynamic'

interface PrefRow {
  user_id: string
  in_app: boolean
  email: boolean
  email_address: string | null
  telegram: boolean
  telegram_chat_id: string | null
  telegram_linked_at: string | null
  web_push: boolean
  digest_only: boolean
}

export default async function NotificationSettingsPage() {
  const user = await getMyUser()
  if (!user) redirect('/login')
  const profile = await getMyProfile()
  const [canManage, roleSides] = await Promise.all([canManageOwnNotifications(), getRoleSides()])
  // Telegram is offered to management-side roles only (admin decides sides at
  // /admin/users); admins additionally get the one-click bot setup.
  const isManagement = profile ? roleSides.management.includes(profile.role as Role) : false
  const isAdmin = profile?.role === 'admin'

  const supabase = await createClient()
  const { data } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  const initial: PrefRow = (data as PrefRow) ?? {
    user_id: user.id,
    in_app: true,
    email: true,
    email_address: profile?.email ?? user.email ?? '',
    telegram: false,
    telegram_chat_id: '',
    telegram_linked_at: null,
    web_push: false,
    digest_only: false,
  }

  // Reports-group status (admin only — the shared management broadcast channel).
  const groupStatus = isAdmin ? await reportsGroupStatus() : null

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader title="Notifications" subtitle="How you're told about things waiting on you." />

      {/* Phone push — anyone can switch their OWN device on/off. */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center flex-shrink-0">
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-gray-900">Phone notifications</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Get alerts on this phone or laptop even when CT HUB isn&apos;t open.
            </p>
            <EnablePushButton />
          </div>
        </div>
      </Card>

      {/* Telegram — management-side roles only. Connecting flips the channel
          on itself, so it doesn't depend on the self-manage grant below. */}
      {isManagement && (
        <TelegramConnect
          connected={!!initial.telegram_chat_id}
          linkedAt={initial.telegram_linked_at}
          isAdmin={isAdmin}
        />
      )}

      {/* Reports group — admin only; the shared management broadcast channel. */}
      {isAdmin && groupStatus?.ok && (
        <ReportsGroupConnect group={groupStatus.group} botUsername={groupStatus.botUsername} />
      )}

      {canManage ? (
        <>
          <Card className="p-5 bg-blue-50 border-blue-200 text-sm text-blue-900">
            <p><b>In-app</b> alerts show in your bell. Choose your channels below.</p>
            <p className="mt-2 text-xs text-blue-800">
              Want to see what&apos;s waiting on you?{' '}
              <Link href="/approvals" className="underline font-medium">Open My Approvals →</Link>
            </p>
          </Card>
          <NotificationPreferencesForm
            userId={user.id}
            initial={{
              in_app: initial.in_app,
              email: initial.email,
              web_push: initial.web_push,
              digest_only: initial.digest_only,
            }}
          />
        </>
      ) : (
        <Card className="p-5 bg-blue-50 border-blue-200 text-sm text-blue-900">
          <p className="font-semibold mb-1">The rest is managed for you.</p>
          <p>
            Your administrator sets which alerts you receive (bell + email) so nothing important is missed.
            You can still turn phone alerts on or off on <b>this device</b> above. To fine-tune your own,
            ask your admin to switch on <b>&ldquo;Let this person manage their own notifications&rdquo;</b> for you.
          </p>
        </Card>
      )}
    </div>
  )
}
