import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: me } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (me?.role !== 'admin') redirect('/dashboard')

  const { data: rows } = await supabase.from('app_settings').select('key, value')
  const settings = Object.fromEntries((rows ?? []).map(r => [r.key, r.value]))

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <PageHeader title="Settings" back="/admin" />

      <Card>
        <CardHeader><CardTitle className="text-base">Admin email</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-500 mb-4">
            The Gmail address that becomes admin on first sign-in. New users with other emails are created as <strong>viewer</strong> by default.
          </p>
          <SettingsForm
            settingKey="admin_email"
            initialValue={settings.admin_email ?? 'construction@srmd.org'}
            placeholder="construction@srmd.org"
            type="email"
          />
        </CardContent>
      </Card>
    </div>
  )
}
