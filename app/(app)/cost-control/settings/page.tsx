import { requirePermission } from '@/lib/auth'
import { getCcSettings } from '@/lib/cost-control/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { CcSettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function CostControlSettingsPage() {
  await requirePermission('cost-control', 'admin')
  const settings = await getCcSettings()

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="Cost Control — Settings"
        subtitle="Switch features on or off and rename the approval fields. Changes apply to everyone the next time a page loads."
        back="/cost-control"
      />
      <Card className="p-5">
        <CcSettingsForm initial={settings} />
      </Card>
    </div>
  )
}
