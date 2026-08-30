import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { getLeadDays, getAiAssistProjects, getScheduleProjects } from '@/lib/schedule/data'
import { ScheduleSettingsForm } from './settings-client'

export const dynamic = 'force-dynamic'

export default async function ScheduleSettingsPage() {
  await requirePermission('schedule', 'view')
  const perms = await getMyPermissions()
  const canEdit = can(perms, 'schedule', 'admin')

  const [leads, aiProjects, projects] = await Promise.all([
    getLeadDays(),
    getAiAssistProjects(),
    getScheduleProjects(),
  ])

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <PageHeader
        title="Schedule settings"
        back="/schedule"
        subtitle="How far ahead of a site start each step has to happen. These three numbers set every Work-Order, budget and drawing deadline in the schedule."
      />
      <ScheduleSettingsForm
        initialLeads={leads}
        initialAiProjects={aiProjects}
        projects={projects.map(p => ({ id: p.id, code: p.code, name: p.name, itemCount: p.item_count }))}
        canEdit={canEdit}
      />
    </div>
  )
}
