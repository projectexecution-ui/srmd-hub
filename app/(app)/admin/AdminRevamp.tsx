import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { ADMIN_AREAS, ADMIN_SCREENS, screensByArea } from '@/lib/revamp/admin-map'
import { visibleTasks, taskSteps, tasksTouching } from '@/lib/revamp/admin-tasks'
import { loadHealth } from '@/lib/revamp/admin-health'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { createClient } from '@/lib/supabase/server'
import { isPendingAccessRequest, allowedEmailSet } from '@/lib/access-requests'
import { REPORT_JOB } from '@/lib/notifications/report-jobs'
import { AdminBrowser, type BrowserScreen, type BrowserTask } from './AdminBrowser'
import { ArrowRight, Users, Building2, Mail, ChevronRight } from 'lucide-react'

/**
 * Admin in three doors (Aksha, 11 Sep 2026: "my Admin page has become too much
 * for me to understand and make changes").
 *
 * What you see, in order:
 *   1. Today   — the few things that are wrong right now, one sentence and one
 *                button each. Nothing else on the page is time-sensitive.
 *   2. Doors   — People, Projects, Messages. Three nouns, because that is how
 *                an admin thinks ("this person", "this project", "this e-mail"),
 *                not the eight code-shaped jobs the previous home listed.
 *   3. More    — everything rare or technical in one fold: module switches, the
 *                CT Hub V1 shell, imports, deleted things, and the full A–Z with
 *                its job checklists for anyone who already knows a screen's name.
 *
 * Nothing was removed. Every screen the previous home listed is still reachable
 * from the fold, so no bookmark and no habit breaks.
 */
export async function AdminRevamp({ isAdmin, disabledSlugs = [], shellCard = null, oldScreens = [] }: { isAdmin: boolean; disabledSlugs?: string[]; shellCard?: React.ReactNode; oldScreens?: Array<{ href: string; label: string }> }) {
  const disabled = new Set(disabledSlugs)
  const supabase = await createClient()
  const [findings, labels, counts] = await Promise.all([loadHealth(), getModuleLabels(), loadCounts(supabase, isAdmin)])
  const visible = (s: { adminOnly?: boolean }) => isAdmin || !s.adminOnly

  const areaLabelOf = new Map(ADMIN_AREAS.map(a => [a.id, a.label]))
  const screenByHref = new Map(ADMIN_SCREENS.map(s => [s.href, s]))

  const screens: BrowserScreen[] = ADMIN_AREAS
    .flatMap(a => screensByArea(a.id, disabled))
    .filter(visible)
    .map(s => ({
      href: s.href,
      label: s.label,
      hint: s.hint,
      moduleLabel: s.module ? labelFor(labels, s.module) : '',
      area: s.area,
      areaLabel: areaLabelOf.get(s.area) ?? s.area,
      jobs: tasksTouching(s.href).map(t => t.label),
    }))

  const shown = new Set(screens.map(s => s.href))
  const tasks: BrowserTask[] = visibleTasks(disabled)
    .map(t => ({
      id: t.id,
      label: t.label,
      hint: t.hint,
      anyOrder: t.anyOrder,
      steps: taskSteps(t, disabled)
        .filter(step => shown.has(step.href))
        .map(step => {
          const s = screenByHref.get(step.href)!
          return { href: step.href, why: step.why, optional: step.optional, label: s.label, moduleLabel: s.module ? labelFor(labels, s.module) : '' }
        }),
    }))
    .filter(t => t.steps.length > 0)

  // Today = the health checks plus the two queues only an admin can clear.
  const today: TodayRow[] = [
    ...(counts.pendingAccess > 0 ? [{ id: 'access', tone: 'warn' as const, text: <><b>{counts.pendingAccess} {counts.pendingAccess === 1 ? 'person is' : 'people are'}</b> waiting for access to the hub.</>, href: '/admin/users', action: 'Approve' }] : []),
    ...(counts.pendingDeletes > 0 ? [{ id: 'deletes', tone: 'warn' as const, text: <><b>{counts.pendingDeletes} deletion{counts.pendingDeletes === 1 ? '' : 's'}</b> {counts.pendingDeletes === 1 ? 'needs' : 'need'} a second pair of eyes.</>, href: '/admin/delete-requests', action: 'Decide' }] : []),
    ...findings.map(f => ({ id: f.id, tone: f.severity === 'info' ? 'info' as const : 'warn' as const, text: <><b>{f.title}.</b> {f.detail}</>, href: f.href, action: f.fixLabel })),
  ]

  const moreScreens = screens.filter(s => MORE.has(s.href))

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader title="Admin" subtitle="Everything you can change, behind three doors." />

      <Today rows={today} />

      {isAdmin && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="list" aria-label="Doors">
          <Door href="/admin/people" icon={Users} title="People"
            text="Who is in the hub, what each person may open and do, how they are alerted."
            count={`${counts.people} people`} />
          <Door href="/admin/projects" icon={Building2} title="Projects"
            text="Who signs each project, who works on it, who sees its indents."
            count={counts.projectsNoHead > 0 ? `${counts.projects} projects · ${counts.projectsNoHead} need a head` : `${counts.projects} projects`} />
          <Door href="/admin/reports" icon={Mail} title="Messages"
            text="Every e-mail, Telegram and in-app alert the hub sends: on or off, to whom, send now."
            count={`${counts.scheduled} scheduled`} />
        </div>
      )}

      <details className="rounded-2xl border border-gray-200 bg-white group" open={!isAdmin}>
        <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-2 text-sm font-semibold text-gray-700 min-h-[44px]">
          <ChevronRight className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-90" />
          More
          <span className="text-[12px] font-normal text-gray-400">hub settings, imports, deleted things, and every screen A–Z</span>
        </summary>
        <div className="px-4 pb-4 space-y-5">
          {moreScreens.length > 0 && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {moreScreens.map(s => (
                <li key={s.href}>
                  <Link href={s.href} className="flex items-start gap-2 rounded-lg px-2 py-2 min-h-[44px] hover:bg-gray-50">
                    <ArrowRight className="h-3.5 w-3.5 text-gray-400 mt-1 flex-shrink-0" />
                    <span className="min-w-0"><span className="block text-sm font-medium text-gray-900">{MORE_LABEL[s.href] ?? s.label}</span><span className="block text-xs text-gray-500">{s.hint}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {shellCard}
          <div>
            <h2 className="text-sm font-bold text-gray-900 mb-2">Every screen, and the jobs that use them</h2>
            <AdminBrowser tasks={tasks} screens={screens} />
          </div>
          {oldScreens.length > 0 && (
            <div>
              <h2 className="text-sm font-bold text-gray-900">Old screens <span className="ml-1 text-[11px] font-normal text-gray-400 tabular-nums">{oldScreens.length}</span></h2>
              <p className="mt-0.5 text-xs text-gray-500">The pre-revamp pages. Everything they showed now lives inside a project or in Bills and Masters; these stay open until you remove them.</p>
              <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                {oldScreens.map(s => (
                  <li key={s.href}><Link href={s.href} className="inline-flex items-center gap-1 text-sm text-indigo-700 hover:underline min-h-[36px]">{s.label} <ArrowRight className="h-3 w-3" /></Link></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}

/** Screens that live in the More fold: rare, technical, or emergency-only. Everything else is behind a door. */
const MORE = new Set<string>([
  '/admin/dashboard-modules', '/admin/manual-upload', '/cost-control/settings', '/cost-control/import',
  '/admin/recycle-bin', '/admin/delete-requests', '/cost-control/audit',
  '/masters', '/cost-control/admin/disciplines',
  '/admin/permissions', '/admin/approvals', '/admin/users',
  '/admin/email', '/admin/notifications', '/bills-pipeline/digest-settings',
  '/procurement-tracker/admin', '/bills-booking/admin', '/admin/sidebar-groups',
])
/** Plain words on the fold; the map keeps its short labels for the A–Z. */
const MORE_LABEL: Record<string, string> = {
  '/admin/approvals': 'Who signs, in order (rules by module)',
  '/admin/users': 'Accounts & access requests',
  '/admin/recycle-bin': 'Deleted things — get one back',
  '/admin/delete-requests': 'Deleted things — requests waiting',
  '/cost-control/audit': 'Deleted things — who changed what',
}

interface TodayRow { id: string; tone: 'warn' | 'info'; text: React.ReactNode; href: string; action: string }

function Today({ rows }: { rows: TodayRow[] }) {
  if (rows.length === 0) {
    return (
      <section aria-label="Today" className="rounded-r-xl border-l-4 border-emerald-500 bg-emerald-50 px-4 py-3">
        <p className="text-sm text-emerald-900">Nothing needs you today. Approvals have signers, alerts have readers, nobody is waiting for access.</p>
      </section>
    )
  }
  const warn = rows.some(r => r.tone === 'warn')
  return (
    <section aria-label="Today" className={`rounded-r-xl border-l-4 px-4 py-2 divide-y ${warn ? 'border-amber-500 bg-amber-50 divide-amber-200/70' : 'border-gray-300 bg-gray-50 divide-gray-200'}`}>
      {rows.map(r => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
          <p className={`text-sm min-w-0 flex-1 ${r.tone === 'warn' ? 'text-amber-950' : 'text-gray-700'}`}>{r.text}</p>
          <Link href={r.href} className={`inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-[13px] font-semibold min-h-[36px] hover:bg-gray-50 ${r.tone === 'warn' ? 'border-amber-300 text-amber-900' : 'border-gray-300 text-gray-800'}`}>
            {r.action} <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      ))}
    </section>
  )
}

function Door({ href, icon: Icon, title, text, count }: { href: string; icon: React.ComponentType<{ className?: string }>; title: string; text: string; count: string }) {
  return (
    <Link href={href} role="listitem" className="group rounded-2xl border border-gray-200 bg-white p-4 flex flex-col gap-2 min-h-[132px] hover:border-indigo-300 hover:bg-indigo-50/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500">
      <span className="h-9 w-9 rounded-xl border border-gray-200 bg-gray-50 grid place-items-center group-hover:bg-white"><Icon className="h-[18px] w-[18px] text-gray-600" /></span>
      <span className="text-base font-semibold text-gray-900">{title}</span>
      <span className="text-[13px] text-gray-600 leading-snug">{text}</span>
      <span className="mt-auto text-[11px] text-gray-400 tabular-nums">{count}</span>
    </Link>
  )
}

async function loadCounts(supabase: Awaited<ReturnType<typeof createClient>>, isAdmin: boolean) {
  const [peopleRes, projRes, apprRes, delRes, emailRes, accessRes, allowedRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('projects').select('id, parent_project_id').is('archived_at', null),
    supabase.from('cc_project_approvers').select('project_id').eq('role', 'project_head'),
    isAdmin ? supabase.from('delete_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending') : Promise.resolve({ count: 0 }),
    supabase.from('app_settings').select('value').eq('key', 'admin_email').maybeSingle(),
    isAdmin ? supabase.from('profiles').select('email, is_active, access_state').eq('is_active', false).is('access_state', null) : Promise.resolve({ data: [] as Array<{ email: string; is_active: boolean; access_state: string | null }> }),
    isAdmin ? supabase.from('allowed_emails').select('email') : Promise.resolve({ data: [] as Array<{ email: string }> }),
  ])
  const projects = (projRes.data ?? []) as Array<{ id: string; parent_project_id: string | null }>
  const parents = new Set(projects.map(p => p.parent_project_id).filter(Boolean) as string[])
  const withHead = new Set(((apprRes.data ?? []) as Array<{ project_id: string }>).map(r => r.project_id))
  const adminEmail = (emailRes.data?.value as string | null) ?? 'projectexecution@construction.srmd.org'
  const allowed = allowedEmailSet((allowedRes.data ?? []) as Array<{ email: string }>)
  const pendingAccess = ((accessRes.data ?? []) as Array<{ email: string; is_active: boolean; access_state: string | null }>)
    .filter(p => isPendingAccessRequest(p, allowed, adminEmail)).length
  return {
    people: peopleRes.count ?? 0,
    projects: projects.length,
    // Groups roll up their children; only real projects need a Project Head.
    projectsNoHead: projects.filter(p => !parents.has(p.id) && !withHead.has(p.id)).length,
    pendingDeletes: delRes.count ?? 0,
    pendingAccess,
    scheduled: Object.keys(REPORT_JOB).length,
  }
}
