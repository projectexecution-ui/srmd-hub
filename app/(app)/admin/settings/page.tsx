import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, getMyProfile, isPortalOwner } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Mail, Users, ShieldCheck, GitBranch, LayoutGrid, Wrench, ExternalLink, Info,
} from 'lucide-react'
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

  // Configuration shortcuts — visible based on what this user can manage.
  const shortcuts = [
    { href: '/admin/users',             icon: Users,       title: 'Users & Roles',     sub: 'Add / deactivate users, set role per user.',          show: true },
    { href: '/admin/permissions',       icon: ShieldCheck, title: 'Permissions',       sub: 'What each role can View / Edit / Admin per module.', show: true },
    { href: '/admin/approvals',         icon: GitBranch,   title: 'Approvals',         sub: 'Who approves what at each stage, across modules.',   show: true },
    { href: '/admin/dashboard-modules', icon: LayoutGrid,  title: 'Dashboard Modules', sub: 'Turn modules on / off for the whole portal.',        show: portalOwner },
    { href: '/jmr/admin/settings',      icon: Wrench,      title: 'JMR settings',      sub: 'GST %, variance tolerance, weekly report time.',     show: true },
  ].filter(s => s.show)

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-6">
      <PageHeader title="Settings" back="/admin" subtitle="Portal-wide configuration" />

      {/* ── General ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Mail className="h-4 w-4 text-gray-500" /> General
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Admin email</p>
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

      {/* ── Configuration shortcuts ───────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Other configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {shortcuts.map(s => (
              <Link key={s.href} href={s.href}
                className="group flex items-start gap-3 p-3 rounded-xl border border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm transition-all">
                <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700 flex-shrink-0">
                  <s.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-gray-900 leading-tight">{s.title}</p>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{s.sub}</p>
                </div>
                <ExternalLink className="h-4 w-4 text-gray-300 group-hover:text-blue-500 flex-shrink-0 mt-1" />
              </Link>
            ))}
          </div>
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
            <Row label="Supabase project">
              <span className="font-mono text-xs">hjwtjrjkmuhhbsbjsqhx</span>
            </Row>
            <Row label="Today">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </Row>
          </dl>
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
