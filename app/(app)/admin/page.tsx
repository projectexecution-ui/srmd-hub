import Link from 'next/link'
import type { ComponentType } from 'react'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import {
  Users, ShieldCheck, LayoutGrid, GitBranch, Trash2, Bell, RotateCcw,
  UserPlus, CalendarDays, UserCog, CircleCheck, AlertTriangle, ListTree,
} from 'lucide-react'
import { getMyPermissions, can, isPortalOwner, getMyProfile, getDisabledModuleSlugs } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { isPendingAccessRequest, allowedEmailSet } from '@/lib/access-requests'
import { MODULES } from '@/lib/modules'
import { cn } from '@/lib/utils'
import { AdminEmailRow } from './AdminEmailRow'
import { IS_DEMO } from '@/lib/demo-mode'
import { AdminRevamp } from './AdminRevamp'

export const dynamic = 'force-dynamic'

export default async function AdminHomePage() {
  const [perms, portalOwner, profile] = await Promise.all([
    getMyPermissions(),
    isPortalOwner(),
    getMyProfile(),
  ])

  // TRIAL DEPLOYMENT: the revamped Admin — all 43 settings screens, including
  // the 34 hidden inside modules, grouped into four areas. Live keeps today's
  // page unchanged.
  if (IS_DEMO) {
    const disabled = await getDisabledModuleSlugs()
    return <AdminRevamp isAdmin={portalOwner || profile?.role === 'admin'} disabledSlugs={Array.from(disabled)} />
  }
  const canEditApprovals = portalOwner || profile?.role === 'admin'
  const canViewUsers = can(perms, 'admin-users', 'view')
  const canSettings = portalOwner || can(perms, 'admin-settings', 'admin')

  const supabase = await createClient()
  const [deleteRes, recycleRes, visRes, apprRes, cronRes, emailRes, activeRes, accessRes] = await Promise.all([
    canEditApprovals
      ? supabase.from('delete_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      : Promise.resolve({ count: 0 }),
    canEditApprovals
      ? supabase.from('recycle_bin').select('id', { count: 'exact', head: true }).is('restored_at', null)
      : Promise.resolve({ count: 0 }),
    portalOwner
      ? supabase.from('module_visibility').select('slug, enabled')
      : Promise.resolve({ data: [] as { slug: string; enabled: boolean }[] }),
    canEditApprovals
      ? supabase.from('approval_rules').select('module_slug')
      : Promise.resolve({ data: [] as { module_slug: string }[] }),
    canEditApprovals
      ? supabase.from('app_settings').select('key, value').in('key', ['cron_heartbeat_am', 'cron_heartbeat_pm'])
      : Promise.resolve({ data: [] as { key: string; value: string }[] }),
    supabase.from('app_settings').select('value').eq('key', 'admin_email').maybeSingle(),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
    canViewUsers
      ? supabase.from('profiles').select('email, is_active, access_state').eq('is_active', false).is('access_state', null)
      : Promise.resolve({ data: [] as { email: string; is_active: boolean; access_state: string | null }[] }),
  ])

  const adminEmail = (emailRes.data?.value as string | null) ?? 'projectexecution@construction.srmd.org'

  // Pending self-service access requests (badge on Users + header).
  let pendingAccessCount = 0
  if (canViewUsers) {
    const [{ data: allowedRows }] = await Promise.all([
      supabase.from('allowed_emails').select('email'),
    ])
    const allowedSet = allowedEmailSet(allowedRows ?? [])
    pendingAccessCount = ((accessRes.data ?? []) as { email: string; is_active: boolean; access_state: string | null }[])
      .filter(p => isPendingAccessRequest(p, allowedSet, adminEmail)).length
  }

  const pendingDeleteCount = deleteRes.count ?? 0
  const recycleCount = recycleRes.count ?? 0
  const activeUsers = activeRes.count ?? 0

  // Dashboard modules: how many are on (missing row = on by default).
  const overrides = new Map((visRes.data ?? []).map(r => [r.slug, r.enabled]))
  const moduleTotal = MODULES.length
  const moduleOn = MODULES.filter(m => (overrides.has(m.slug) ? !!overrides.get(m.slug) : true)).length

  // Approvals: how many modules have a chain configured.
  const approvalModules = new Set(((apprRes.data ?? []) as { module_slug: string }[])
    .map(r => r.module_slug).filter(s => s !== 'blueprint-demo')).size

  // Notifications health from the cron heartbeats (see CronHealthStrip).
  const cronBy = new Map(((cronRes.data ?? []) as { key: string; value: string }[]).map(r => [r.key, r.value]))
  const now = Date.now()
  const isFresh = (iso?: string) => { if (!iso) return null; const t = Date.parse(iso); return Number.isNaN(t) ? null : now - t <= 26 * 3_600_000 }
  const amFresh = isFresh(cronBy.get('cron_heartbeat_am'))
  const pmFresh = isFresh(cronBy.get('cron_heartbeat_pm'))
  const cronKnown = cronBy.size > 0
  const cronHealthy = amFresh === true && pmFresh === true

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const who = profile?.name || profile?.full_name || profile?.email || 'you'

  const sections: { title: string; tiles: TileDef[] }[] = [
    {
      title: 'People & access',
      tiles: [
        { href: '/admin/users', icon: Users, title: 'Users & Roles', sub: 'Assign roles, deactivate accounts', show: canViewUsers, iconCls: 'bg-indigo-50 text-indigo-600', badge: pendingAccessCount > 0 ? String(pendingAccessCount) : null, badgeCls: 'bg-amber-100 text-amber-800' },
        { href: '/admin/permissions', icon: ShieldCheck, title: 'Permissions', sub: 'Who can view / edit / admin / delete each module', show: can(perms, 'admin-permissions', 'view'), iconCls: 'bg-indigo-50 text-indigo-600' },
      ],
    },
    {
      title: 'Approvals & deletes',
      tiles: [
        { href: '/admin/approvals', icon: GitBranch, title: 'Approvals', sub: 'Who signs off, in order — per module', show: canEditApprovals, iconCls: 'bg-blue-50 text-blue-600', badge: approvalModules > 0 ? `${approvalModules} module${approvalModules === 1 ? '' : 's'}` : null, badgeCls: 'bg-blue-50 text-blue-700 border border-blue-100' },
        { href: '/admin/delete-requests', icon: Trash2, title: 'Delete Requests', sub: 'Approve / reject pending deletes', show: canEditApprovals, iconCls: 'bg-rose-50 text-rose-600', badge: pendingDeleteCount > 0 ? String(pendingDeleteCount) : null, badgeCls: 'bg-rose-100 text-rose-700' },
        { href: '/admin/recycle-bin', icon: RotateCcw, title: 'Recycle Bin', sub: 'Restore deleted items — kept forever', show: canEditApprovals, iconCls: 'bg-slate-100 text-slate-600', badge: recycleCount > 0 ? String(recycleCount) : null, badgeCls: 'bg-slate-100 text-slate-600' },
      ],
    },
    {
      title: 'System',
      tiles: [
        { href: '/admin/notifications', icon: Bell, title: 'Notifications', sub: 'Which alerts the team gets, by channel & role', show: canEditApprovals, iconCls: 'bg-emerald-50 text-emerald-600', badge: cronHealthy ? 'OK' : cronKnown ? 'Check' : null, badgeCls: cronHealthy ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800', badgeIcon: cronHealthy ? CircleCheck : AlertTriangle },
        { href: '/admin/dashboard-modules', icon: LayoutGrid, title: 'Dashboard Modules', sub: 'Turn modules on / off for the portal', show: portalOwner, iconCls: 'bg-violet-50 text-violet-600', badge: `${moduleOn}/${moduleTotal}`, badgeCls: 'bg-slate-100 text-slate-600' },
        { href: '/admin/sidebar-groups', icon: ListTree, title: 'Sidebar Groups', sub: 'Nest side-pane modules under names you choose', show: canEditApprovals, iconCls: 'bg-indigo-50 text-indigo-600' },
      ],
    },
  ]
  const visibleSections = sections.map(s => ({ ...s, tiles: s.tiles.filter(t => t.show) })).filter(s => s.tiles.length > 0)
  const hasAny = visibleSections.length > 0 || canSettings

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader title="Admin" subtitle="App configuration" />

      {!hasAny ? (
        <p className="text-sm text-gray-500 text-center py-12">You don&apos;t have admin access.</p>
      ) : (
        <div className="space-y-1">
          {/* Status header (was the Settings "About this portal" box). */}
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="flex items-center gap-x-2.5 gap-y-1.5 flex-wrap">
              <HdrChip icon={UserCog} text={`${who} · ${profile?.role ?? ''}${portalOwner ? ' · Portal Owner' : ''}`} />
              <HdrChip icon={Users} text={`${activeUsers} active`} />
              <HdrChip icon={CalendarDays} text={today} muted />
            </div>
            {(pendingAccessCount > 0 || pendingDeleteCount > 0) && (
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Needs you</span>
                {pendingAccessCount > 0 && (
                  <NeedChip href="/admin/users" icon={UserPlus} text={`${pendingAccessCount} access request${pendingAccessCount === 1 ? '' : 's'}`} cls="bg-amber-50 text-amber-800 border-amber-200" />
                )}
                {pendingDeleteCount > 0 && (
                  <NeedChip href="/admin/delete-requests" icon={Trash2} text={`${pendingDeleteCount} delete request${pendingDeleteCount === 1 ? '' : 's'}`} cls="bg-rose-50 text-rose-700 border-rose-200" />
                )}
              </div>
            )}
          </div>

          {visibleSections.map(section => (
            <div key={section.title}>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mt-5 mb-2 px-1">{section.title}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {section.tiles.map(t => (
                  <Link key={t.href} href={t.href}>
                    <Card className="p-4 hover:shadow-md transition-shadow relative h-full">
                      {t.badge != null && (
                        <span className={cn('absolute top-3 right-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold', t.badgeCls)}>
                          {t.badgeIcon ? <t.badgeIcon className="h-3 w-3" /> : null}{t.badge}
                        </span>
                      )}
                      <span className={cn('inline-flex h-9 w-9 items-center justify-center rounded-lg mb-2.5', t.iconCls)}>
                        <t.icon className="h-5 w-5" />
                      </span>
                      <h3 className="font-semibold text-gray-900 text-sm">{t.title}</h3>
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug">{t.sub}</p>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          ))}

          {/* The one real portal-wide setting — a quiet read-only line, edit on click. */}
          {canSettings && <AdminEmailRow email={adminEmail} />}
        </div>
      )}
    </div>
  )
}

interface TileDef {
  href: string
  icon: ComponentType<{ className?: string }>
  title: string
  sub: string
  show: boolean
  iconCls: string
  badge?: string | null
  badgeCls?: string
  badgeIcon?: ComponentType<{ className?: string }>
}

function HdrChip({ icon: Icon, text, muted }: { icon: ComponentType<{ className?: string }>; text: string; muted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full bg-white border border-gray-200 px-2.5 py-1 text-[11px] font-semibold', muted ? 'text-gray-500' : 'text-gray-700')}>
      <Icon className="h-3.5 w-3.5 text-gray-400" /> {text}
    </span>
  )
}

function NeedChip({ href, icon: Icon, text, cls }: { href: string; icon: ComponentType<{ className?: string }>; text: string; cls: string }) {
  return (
    <Link href={href} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold hover:brightness-95 transition', cls)}>
      <Icon className="h-3.5 w-3.5" /> {text}
    </Link>
  )
}
