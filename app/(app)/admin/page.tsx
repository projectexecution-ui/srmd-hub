import Link from 'next/link'
import type { ComponentType } from 'react'
import { PageHeader } from '@/components/PageHeader'
import {
  Users, ShieldCheck, GitBranch, Trash2, Bell, RotateCcw, UserPlus, CalendarDays, UserCog,
  CircleCheck, AlertTriangle, LayoutGrid, Database, ListTree, Settings2, Mail, ChevronRight,
} from 'lucide-react'
import { getMyPermissions, can, isPortalOwner, getMyProfile, getDisabledModuleSlugs } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { isPendingAccessRequest, allowedEmailSet } from '@/lib/access-requests'
import { MODULES } from '@/lib/modules'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { ADMIN_AREAS, screensFor, type AdminArea, type AdminScreen } from '@/lib/admin-registry'
import { cn } from '@/lib/utils'
import { AdminEmailRow } from './AdminEmailRow'

export const dynamic = 'force-dynamic'

// ONE admin. Every settings screen in the hub — the 9 that always lived here
// and the 34 that grew inside modules — listed from lib/admin-registry.ts,
// grouped by the job, collapsed by default (the "needs you" line stays open).
// A screen inside a switched-off module is not offered; a screen the viewer's
// role cannot open (per the permission matrix) is not offered either.
export default async function AdminHomePage() {
  const [perms, portalOwner, profile, disabled, labels] = await Promise.all([
    getMyPermissions(), isPortalOwner(), getMyProfile(), getDisabledModuleSlugs(), getModuleLabels(),
  ])
  const isAdmin = portalOwner || profile?.role === 'admin'
  const canViewUsers = can(perms, 'admin-users', 'view')
  const canSettings = portalOwner || can(perms, 'admin-settings', 'admin')

  // Can this person open a given screen? Portal-wide screens follow the old
  // rule (admin / Portal Owner, or the admin-* slugs); module screens need
  // admin on that module in the matrix, except the two per-person ones.
  const SELF_SERVICE = new Set(['/settings/notifications'])
  const canOpen = (s: AdminScreen): boolean => {
    if (SELF_SERVICE.has(s.href)) return true
    if (s.ownerOnly) return portalOwner
    if (!s.module) {
      if (s.href === '/admin/users') return canViewUsers
      if (s.href === '/admin/permissions') return can(perms, 'admin-permissions', 'view')
      return isAdmin
    }
    return can(perms, s.module, 'admin') || (isAdmin && can(perms, s.module, 'view'))
  }

  const supabase = await createClient()
  const [deleteRes, recycleRes, visRes, apprRes, cronRes, emailRes, activeRes, accessRes] = await Promise.all([
    isAdmin ? supabase.from('delete_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0 }),
    isAdmin ? supabase.from('recycle_bin').select('id', { count: 'exact', head: true }).is('restored_at', null) : Promise.resolve({ count: 0 }),
    portalOwner ? supabase.from('module_visibility').select('slug, enabled') : Promise.resolve({ data: [] as { slug: string; enabled: boolean }[] }),
    isAdmin ? supabase.from('approval_rules').select('module_slug') : Promise.resolve({ data: [] as { module_slug: string }[] }),
    isAdmin ? supabase.from('app_settings').select('key, value').in('key', ['cron_heartbeat_am', 'cron_heartbeat_pm']) : Promise.resolve({ data: [] as { key: string; value: string }[] }),
    supabase.from('app_settings').select('value').eq('key', 'admin_email').maybeSingle(),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
    canViewUsers
      ? supabase.from('profiles').select('email, is_active, access_state').eq('is_active', false).is('access_state', null)
      : Promise.resolve({ data: [] as { email: string; is_active: boolean; access_state: string | null }[] }),
  ])
  const adminEmail = (emailRes.data?.value as string | null) ?? 'projectexecution@construction.srmd.org'

  let pendingAccessCount = 0
  if (canViewUsers) {
    const { data: allowedRows } = await supabase.from('allowed_emails').select('email')
    const allowedSet = allowedEmailSet(allowedRows ?? [])
    pendingAccessCount = ((accessRes.data ?? []) as { email: string; is_active: boolean; access_state: string | null }[])
      .filter(p => isPendingAccessRequest(p, allowedSet, adminEmail)).length
  }
  const pendingDeleteCount = deleteRes.count ?? 0
  const recycleCount = recycleRes.count ?? 0
  const activeUsers = activeRes.count ?? 0
  const overrides = new Map((visRes.data ?? []).map(r => [r.slug, r.enabled]))
  const moduleOn = MODULES.filter(m => (overrides.has(m.slug) ? !!overrides.get(m.slug) : true)).length
  const approvalModules = new Set(((apprRes.data ?? []) as { module_slug: string }[]).map(r => r.module_slug).filter(s => s !== 'blueprint-demo')).size
  const cronBy = new Map(((cronRes.data ?? []) as { key: string; value: string }[]).map(r => [r.key, r.value]))
  const now = Date.now()
  const isFresh = (iso?: string) => { if (!iso) return null; const t = Date.parse(iso); return Number.isNaN(t) ? null : now - t <= 26 * 3_600_000 }
  const cronKnown = cronBy.size > 0
  const cronHealthy = isFresh(cronBy.get('cron_heartbeat_am')) === true && isFresh(cronBy.get('cron_heartbeat_pm')) === true

  // Per-screen badges, where a screen has a live number worth showing.
  const badge = (href: string): { text: string; cls: string; icon?: ComponentType<{ className?: string }> } | null => {
    switch (href) {
      case '/admin/users': return pendingAccessCount > 0 ? { text: `${pendingAccessCount} waiting`, cls: 'bg-amber-100 text-amber-800' } : null
      case '/admin/delete-requests': return pendingDeleteCount > 0 ? { text: String(pendingDeleteCount), cls: 'bg-rose-100 text-rose-700' } : null
      case '/admin/recycle-bin': return recycleCount > 0 ? { text: String(recycleCount), cls: 'bg-slate-100 text-slate-600' } : null
      case '/admin/approvals': return approvalModules > 0 ? { text: `${approvalModules} module${approvalModules === 1 ? '' : 's'}`, cls: 'bg-blue-50 text-blue-700 border border-blue-100' } : null
      case '/admin/notifications': return cronHealthy ? { text: 'jobs OK', cls: 'bg-emerald-100 text-emerald-700', icon: CircleCheck } : cronKnown ? { text: 'check jobs', cls: 'bg-amber-100 text-amber-800', icon: AlertTriangle } : null
      case '/admin/dashboard-modules': return { text: `${moduleOn}/${MODULES.length} on`, cls: 'bg-slate-100 text-slate-600' }
      default: return null
    }
  }

  const AREA_ICON: Record<AdminArea, ComponentType<{ className?: string }>> = {
    people: Users, approvals: GitBranch, notifications: Mail, masters: ListTree, data: Database, system: Settings2,
  }
  const areas = ADMIN_AREAS
    .map(a => ({ ...a, screens: screensFor(a.id, { disabled, portalOwner }).filter(canOpen) }))
    .filter(a => a.screens.length > 0)
  const hasAny = areas.length > 0 || canSettings
  const totalScreens = areas.reduce((t, a) => t + a.screens.length, 0)

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const who = profile?.name || profile?.full_name || profile?.email || 'you'
  const moduleName = (slug: string) => slug ? labelFor(labels, slug) : 'Portal'

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader title="Admin" subtitle={`Every setting in one place — ${totalScreens} screens across ${areas.length} areas`} />

      {!hasAny ? (
        <p className="text-sm text-gray-500 text-center py-12">You don&apos;t have admin access.</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
            <div className="flex items-center gap-x-2.5 gap-y-1.5 flex-wrap">
              <HdrChip icon={UserCog} text={`${who} · ${profile?.role ?? ''}${portalOwner ? ' · Portal Owner' : ''}`} />
              <HdrChip icon={Users} text={`${activeUsers} active`} />
              {portalOwner && <HdrChip icon={LayoutGrid} text={`${moduleOn}/${MODULES.length} modules on`} />}
              <HdrChip icon={CalendarDays} text={today} muted />
            </div>
            {(pendingAccessCount > 0 || pendingDeleteCount > 0 || (cronKnown && !cronHealthy)) && (
              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Needs you</span>
                {pendingAccessCount > 0 && <NeedChip href="/admin/users" icon={UserPlus} text={`${pendingAccessCount} access request${pendingAccessCount === 1 ? '' : 's'}`} cls="bg-amber-50 text-amber-800 border-amber-200" />}
                {pendingDeleteCount > 0 && <NeedChip href="/admin/delete-requests" icon={Trash2} text={`${pendingDeleteCount} delete request${pendingDeleteCount === 1 ? '' : 's'}`} cls="bg-rose-50 text-rose-700 border-rose-200" />}
                {cronKnown && !cronHealthy && <NeedChip href="/admin/notifications" icon={AlertTriangle} text="a scheduled job did not run" cls="bg-amber-50 text-amber-800 border-amber-200" />}
              </div>
            )}
          </div>

          {/* Areas — collapsed by default; the first (People & access) open so the
              page never lands as a wall of shut drawers. */}
          {areas.map((area, i) => {
            const Icon = AREA_ICON[area.id]
            // Group the area's screens by module so the eye sees "JMR: four
            // things" instead of fourteen unrelated rows.
            const byModule = new Map<string, AdminScreen[]>()
            for (const s of area.screens) { const arr = byModule.get(s.module) ?? []; arr.push(s); byModule.set(s.module, arr) }
            const groups = [...byModule.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : moduleName(a).localeCompare(moduleName(b))))
            return (
              <details key={area.id} open={i === 0} className="group rounded-2xl border border-gray-200 bg-white open:shadow-sm">
                <summary className="list-none cursor-pointer select-none flex items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 flex-shrink-0"><Icon className="h-5 w-5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-gray-900 text-sm">{area.label}</span>
                    <span className="block text-xs text-gray-500 truncate">{area.hint}</span>
                  </span>
                  <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{area.screens.length}</span>
                  <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" />
                </summary>
                <div className="border-t border-gray-100 divide-y divide-gray-100">
                  {groups.map(([mod, screens]) => (
                    <div key={mod || '_portal'} className="px-4 py-2.5">
                      {groups.length > 1 && (
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">{moduleName(mod)}</p>
                      )}
                      <ul className="space-y-0.5">
                        {screens.map(s => {
                          const b = badge(s.href)
                          return (
                            <li key={s.href}>
                              <Link href={s.href} className="flex items-center gap-3 rounded-lg px-2 py-2 -mx-2 hover:bg-gray-50 min-h-[44px]">
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium text-gray-900">{s.label}</span>
                                  <span className="block text-xs text-gray-500 truncate">{s.hint}</span>
                                </span>
                                {b && (
                                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap', b.cls)}>
                                    {b.icon ? <b.icon className="h-3 w-3" /> : null}{b.text}
                                  </span>
                                )}
                                <ChevronRight className="h-4 w-4 text-gray-300 flex-shrink-0" />
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            )
          })}

          {canSettings && <AdminEmailRow email={adminEmail} />}
        </div>
      )}
    </div>
  )
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

// Keep the old icon imports referenced so the sidebar's expectations (Shield
// on /admin) and any deep-link chips still resolve. ShieldCheck / RotateCcw /
// Bell are used by the badge set above through the registry labels.
void ShieldCheck; void RotateCcw; void Bell
