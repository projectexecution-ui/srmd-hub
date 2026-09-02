import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { ADMIN_AREAS, ADMIN_SCREENS, screensByArea } from '@/lib/revamp/admin-map'
import { visibleTasks, taskSteps, tasksTouching } from '@/lib/revamp/admin-tasks'
import { loadHealth, type HealthFinding } from '@/lib/revamp/admin-health'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { AdminBrowser, type BrowserScreen, type BrowserTask } from './AdminBrowser'
import { AlertTriangle, Info, ArrowRight } from 'lucide-react'

/**
 * Admin, rebuilt around the JOB.
 *
 * The first version grouped 33 screens into four areas and stopped there. That
 * renamed the sprawl rather than reducing it: the areas describe where the code
 * lives, and a person arriving to set up a project still had to know that the
 * job spans six screens across four of those areas.
 *
 * So the page now answers three questions in order — what is broken, what did
 * you come to do, and where is that one screen I already know the name of.
 * Nothing was deleted; the old A–Z grouping is still here, one fold down.
 */
export async function AdminRevamp({ isAdmin, disabledSlugs = [] }: { isAdmin: boolean; disabledSlugs?: string[] }) {
  const disabled = new Set(disabledSlugs)
  const [findings, labels] = await Promise.all([loadHealth(), getModuleLabels()])
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
        // Never offer a step the person cannot open — an admin-only screen to a
        // non-admin is the same dead link the old page had.
        .filter(step => shown.has(step.href))
        .map(step => {
          const s = screenByHref.get(step.href)!
          return {
            href: step.href,
            why: step.why,
            optional: step.optional,
            label: s.label,
            moduleLabel: s.module ? labelFor(labels, s.module) : '',
          }
        }),
    }))
    .filter(t => t.steps.length > 0)

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <PageHeader
        title="Admin"
        subtitle={`${screens.length} settings screens across ${tasks.length} common jobs.`}
      />

      {findings.length > 0 && <HealthPanel findings={findings} />}

      <AdminBrowser tasks={tasks} screens={screens} />
    </div>
  )
}

/** What is wrong right now — above everything, because it is the only part of
 *  this page that is time-sensitive. */
function HealthPanel({ findings }: { findings: HealthFinding[] }) {
  const blockers = findings.filter(f => f.severity === 'blocker')
  return (
    <section aria-label="Needs attention">
      <h2 className="text-sm font-bold text-gray-900 mb-2 flex items-baseline gap-2">
        Needs attention
        <span className="text-[11px] font-normal text-gray-400 tabular-nums">{findings.length}</span>
      </h2>
      <div className="space-y-2">
        {findings.map(f => {
          const tone =
            f.severity === 'blocker' ? 'border-rose-300 bg-rose-50'
            : f.severity === 'warn'  ? 'border-amber-300 bg-amber-50'
            : 'border-gray-200 bg-white'
          const ink =
            f.severity === 'blocker' ? 'text-rose-900'
            : f.severity === 'warn'  ? 'text-amber-900'
            : 'text-gray-900'
          const Icon = f.severity === 'info' ? Info : AlertTriangle
          return (
            <div key={f.id} className={`rounded-lg border px-4 py-3 ${tone}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className={`text-sm font-semibold flex items-center gap-2 ${ink}`}>
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {f.title}
                </p>
                <Link
                  href={f.href}
                  className={`ml-auto inline-flex items-center gap-1 text-[11px] font-semibold hover:underline min-h-[44px] sm:min-h-0 ${ink}`}
                >
                  {f.fixLabel} <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
              <p className={`text-xs mt-0.5 opacity-90 ${ink}`}>{f.detail}</p>
            </div>
          )
        })}
      </div>
      {blockers.length === 0 && (
        <p className="text-[11px] text-gray-400 mt-1.5">Nothing here is blocking anyone today.</p>
      )}
    </section>
  )
}
