import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requirePermission, can, getMyProfile } from '@/lib/auth'
import {
  Wrench, ClipboardCheck, BarChart3, Settings, Grid, User,
  Plus, ArrowRight, Clock, AlertTriangle, CalendarDays, History,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function JMRPage() {
  const perms = await requirePermission('jmr', 'view')
  const profile = await getMyProfile()
  const role = profile?.role
  const canLog = can(perms, 'jmr', 'edit')
  const isApprover = role === 'admin' || role === 'head' || role === 'founder'

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const now = new Date()
  const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString().slice(0, 10)

  const [pendingRes, weekRes, myFlaggedRes] = await Promise.all([
    supabase.from('jmr_daily_entries').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    supabase.from('jmr_daily_entries').select('id', { count: 'exact', head: true }).gte('entry_date', weekAgo),
    user
      ? supabase.from('jmr_daily_entries').select('id', { count: 'exact', head: true }).eq('logged_by_user_id', user.id).eq('status', 'flagged')
      : Promise.resolve({ count: 0 }),
  ])
  const pending = pendingRes.count ?? 0
  const weekEntries = weekRes.count ?? 0
  const myFlagged = myFlaggedRes.count ?? 0

  const tiles = [
    { slug: 'my',        label: 'My JMR',        href: '/jmr/my',        icon: User,           tone: 'bg-indigo-50 text-indigo-600', accent: 'text-indigo-600', desc: 'Your entries · pending approval · flagged', badge: myFlagged > 0 ? { text: `${myFlagged} flagged`, cls: 'bg-rose-50 text-rose-600' } : null, show: can(perms, 'jmr', 'view') },
    { slug: 'matrix',    label: 'JMR Matrix',    href: '/jmr/matrix',    icon: Grid,           accent: 'text-emerald-600', tone: 'bg-emerald-50 text-emerald-600', desc: 'Equipment & manpower summary, sub-project × item', badge: null, show: can(perms, 'jmr', 'view') },
    { slug: 'log',       label: 'JMR Log',       href: '/jmr/log',       icon: History,        accent: 'text-cyan-600', tone: 'bg-cyan-50 text-cyan-600', desc: 'Full history & audit trail — who logged & reviewed, when', badge: null, show: can(perms, 'jmr', 'view') },
    { slug: 'dashboard', label: 'JMR Dashboard', href: '/jmr/dashboard', icon: BarChart3,      accent: 'text-purple-600', tone: 'bg-purple-50 text-purple-600', desc: 'Logged spend + entries awaiting approval', badge: isApprover && pending > 0 ? { text: `${pending} to review`, cls: 'bg-amber-50 text-amber-600' } : null, show: can(perms, 'jmr', 'view') && isApprover },
    { slug: 'admin',     label: 'JMR Admin',     href: '/jmr/admin',     icon: Settings,       accent: 'text-slate-600', tone: 'bg-slate-100 text-slate-600', desc: 'Items, rate cards, contractors, settings', badge: null, show: can(perms, 'jmr-admin', 'view') },
  ].filter(t => t.show)

  const stats = [
    ...(isApprover ? [{ key: 'pending', label: 'Pending approval', value: String(pending), icon: Clock, ic: pending > 0 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400', href: '/jmr/dashboard' }] : []),
    { key: 'week', label: 'Entries this week', value: String(weekEntries), icon: CalendarDays, ic: 'bg-blue-100 text-blue-600', href: '/jmr/matrix' },
    ...(myFlagged > 0 ? [{ key: 'flagged', label: 'My flagged', value: String(myFlagged), icon: AlertTriangle, ic: 'bg-rose-100 text-rose-600', href: '/jmr/my' }] : []),
  ]

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-900">JMR / Machinery</h1>
        <p className="text-sm text-gray-500 mt-0.5">Site machinery hours, daily entries, and approvals</p>
      </div>

      {/* Hero — the daily action */}
      {canLog && (
        <Link
          href="/jmr/entry"
          className="group block rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-4 sm:p-5 mb-4 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all"
        >
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex items-center gap-3 sm:gap-3.5 min-w-0">
              <span className="h-11 w-11 sm:h-12 sm:w-12 rounded-2xl bg-white/15 grid place-items-center flex-shrink-0">
                <ClipboardCheck className="h-5 w-5 sm:h-6 sm:w-6" />
              </span>
              <div className="min-w-0">
                <p className="text-base sm:text-lg font-bold leading-tight">Log today&apos;s machinery &amp; manpower</p>
                <p className="text-xs sm:text-sm text-white/80 mt-0.5">Pick project → contractor → item → hours, attach the signed log sheet.</p>
              </div>
            </div>
            <span className="inline-flex items-center justify-center gap-1.5 bg-white text-blue-700 font-semibold text-sm px-4 py-2.5 sm:py-2 rounded-xl w-full sm:w-auto sm:ml-auto flex-shrink-0 group-hover:gap-2.5 transition-all">
              <Plus className="h-4 w-4" /> New entry
            </span>
          </div>
        </Link>
      )}

      {/* Live stat strip */}
      {stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-5">
          {stats.map(s => {
            const Icon = s.icon
            return (
              <Link key={s.key} href={s.href} className="rounded-xl bg-white ring-1 ring-gray-200/70 shadow-sm px-3.5 py-3 hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="flex items-center gap-1.5">
                  <span className={`h-6 w-6 rounded-md grid place-items-center ${s.ic}`}><Icon className="h-3.5 w-3.5" /></span>
                  <span className="text-[10.5px] font-semibold text-gray-500 uppercase tracking-wide truncate">{s.label}</span>
                </div>
                <div className="text-2xl font-bold text-gray-900 mt-1.5 tabular-nums">{s.value}</div>
              </Link>
            )
          })}
        </div>
      )}

      {/* Navigation tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        {tiles.map(t => (
          <Link key={t.slug} href={t.href} className="group rounded-2xl bg-white ring-1 ring-gray-200/70 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all p-5 flex flex-col">
            <div className="flex items-start justify-between">
              <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${t.tone}`}>
                <t.icon className="h-5 w-5" />
              </span>
              {t.badge && (
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${t.badge.cls}`}>{t.badge.text}</span>
              )}
            </div>
            <p className="font-semibold text-gray-900 mt-3">{t.label}</p>
            <p className="text-xs text-gray-500 mt-1 flex-1">{t.desc}</p>
            <span className={`mt-3 inline-flex items-center gap-1 text-xs font-medium ${t.accent} opacity-0 group-hover:opacity-100 group-hover:gap-1.5 transition-all`}>
              Open <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </Link>
        ))}
        {tiles.length === 0 && (
          <div className="col-span-full rounded-2xl bg-white ring-1 ring-gray-200/70 py-10 text-center">
            <Wrench className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-500">You don&apos;t have access to any JMR screens yet. Ask an admin.</p>
          </div>
        )}
      </div>
    </div>
  )
}
