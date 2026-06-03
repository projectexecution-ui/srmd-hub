// Per-user notification preferences. Lives at /settings/notifications and
// is opened from the bell's gear icon. Each row in the form is a single
// channel toggle (in_app / email / telegram / web_push) plus an address
// where the channel needs one (email address, telegram chat id).
//
// Phase 1 ships in_app fully working; the other channels save the toggle
// + address so users can opt in now, but background workers + Edge
// Functions that actually send are wired in Phase 2/3/4.

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getMyUser, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { NotificationPreferencesForm } from './preferences-form'

export const dynamic = 'force-dynamic'

interface PrefRow {
  user_id: string
  in_app: boolean
  email: boolean
  email_address: string | null
  telegram: boolean
  telegram_chat_id: string | null
  web_push: boolean
  digest_only: boolean
}

export default async function NotificationSettingsPage() {
  const user = await getMyUser()
  if (!user) redirect('/login')
  const profile = await getMyProfile()

  const supabase = await createClient()
  const { data } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  // Defaults match the DB defaults so a fresh user sees a sensible state.
  const initial: PrefRow = (data as PrefRow) ?? {
    user_id: user.id,
    in_app: true,
    email: true,
    email_address: profile?.email ?? user.email ?? '',
    telegram: false,
    telegram_chat_id: '',
    web_push: false,
    digest_only: false,
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="Choose how you get told about things waiting on you."
      />

      <Card className="p-5 bg-blue-50 border-blue-200 text-sm text-blue-900">
        <p>
          <b>In-app</b> notifications are live and showing in your bell already. <b>Email</b>, <b>Telegram</b>, and <b>Web push</b>{' '}
          channels save your preferences here — sending is being wired up in subsequent updates.
        </p>
        <p className="mt-2 text-xs text-blue-800">
          Want to manage who&apos;s approving what?{' '}
          <Link href="/approvals" className="underline font-medium">Open My Approvals →</Link>
        </p>
      </Card>

      <NotificationPreferencesForm
        userId={user.id}
        initial={{
          in_app: initial.in_app,
          email: initial.email,
          email_address: initial.email_address ?? (profile?.email ?? user.email ?? ''),
          telegram: initial.telegram,
          telegram_chat_id: initial.telegram_chat_id ?? '',
          web_push: initial.web_push,
          digest_only: initial.digest_only,
        }}
      />
    </div>
  )
}
