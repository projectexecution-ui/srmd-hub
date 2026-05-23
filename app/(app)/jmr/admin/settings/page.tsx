import { requirePermission } from '@/lib/auth'
import { Card } from '@/components/ui/card'
import { getJmrSettings } from '@/lib/jmr/settings'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function JmrSettingsPage() {
  await requirePermission('jmr-admin', 'edit')
  const settings = await getJmrSettings()
  return (
    <Card className="p-4">
      <h2 className="text-lg font-bold mb-1">Settings</h2>
      <p className="text-xs text-gray-500 mb-4">GST rate, variance tolerance, weekly report schedule & recipients.</p>
      <SettingsForm initial={settings} />
    </Card>
  )
}
