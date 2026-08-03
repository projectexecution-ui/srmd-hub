import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile, isPortalOwner } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Mail, Info } from 'lucide-react'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  await requirePermission('admin-settings', 'admin')
  const supabase = await createClient()

  const [{ data: rows }, profile, portalOwner, profilesCount] = await Promise.all([
    supabase.from('app_settings').select('key, value'),
    getMyProfile(),
    isPortalOwner(),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
  ])
  const settings = Object.fromEntries((rows ?? []).map(r => [r.key, r.value]))

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader title="Settings" back="/admin" subtitle="Portal-wide configuration" />

      {/* ── General ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4 text-gray-500" /> Admin email
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-gray-500">
            The Gmail address that becomes admin on first sign-in. New users with other emails are created as <b>viewer</b> by default.
          </p>
          <SettingsForm
            settingKey="admin_email"
            initialValue={settings.admin_email ?? 'projectexecution@construction.srmd.org'}
            placeholder="projectexecution@construction.srmd.org"
            type="email"
          />
        </CardContent>
      </Card>

      {/* ── About ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-gray-500" /> About this portal
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Row label="Signed in as">
              <span className="font-medium text-gray-900">{profile?.name || profile?.full_name || profile?.email}</span>
              <span className="ml-2 text-xs text-gray-500">({profile?.role}{portalOwner ? ' · Portal Owner' : ''})</span>
            </Row>
            <Row label="Active users">{profilesCount.count ?? 0}</Row>
            <Row label="Today">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}
            </Row>
          </dl>
          <p className="text-xs text-gray-400 mt-4">
            Manage users, permissions, approvals and module visibility from the{' '}
            <a href="/admin" className="text-blue-600 hover:underline">Admin</a> home.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-800 mt-0.5">{children}</dd>
    </div>
  )
}
