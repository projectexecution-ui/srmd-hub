import { requirePermission } from '@/lib/auth'
import { getInvSettings } from '@/lib/inventory/settings'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { InvSettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function InventorySettingsPage() {
  await requirePermission('inventory', 'admin')
  const settings = await getInvSettings()

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="Inventory — Settings"
        subtitle="Choose how much approval sits between a request and the storekeeper handing over material. Change it anytime — it applies to everyone immediately."
        back="/inventory"
      />
      <Card className="p-5">
        <InvSettingsForm initial={settings} />
      </Card>
    </div>
  )
}
