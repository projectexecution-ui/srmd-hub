import Link from 'next/link'
import { requirePermission } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { loadRoof } from '@/lib/notifications/roof'
import { spread } from '@/lib/notifications/catalog'
import { RoofClient, type RoofRow } from './RoofClient'
import { AlertTriangle, Mail } from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * One roof for everything CT Hub sends.
 *
 * The on/off switches were already central (/admin/notifications). WHO GETS IT
 * never was: recipients live in a dozen app_settings keys across half a dozen
 * screens, and the mail-sending cron jobs each resolve their own. This page
 * does not move any of that — it reads all of it, so the answer to "who gets
 * this, and is it actually going out" is in one place, and a report that is
 * switched on but reaches nobody says so instead of failing quietly.
 */
export default async function EmailRoofPage() {
  await requirePermission('admin-settings', 'view')

  const [{ rows, silent, ignoring }, labels] = await Promise.all([
    loadRoof(),
    getModuleLabels(),
  ])

  const s = spread()
  const clientRows: RoofRow[] = rows.map(r => ({
    key: r.message.key,
    label: r.message.label,
    module: r.message.module,
    moduleLabel: labelFor(labels, r.message.module),
    kind: r.message.kind,
    trigger: r.message.trigger,
    schedule: r.message.schedule,
    channels: r.message.channels,
    channelsOn: r.channelsOn,
    respectsRules: r.message.respectsRules,
    enabled: r.enabled,
    recipients: r.recipients,
    who: r.message.recipients.who,
    settingsHref: r.message.settingsHref,
    warning: r.warning,
  }))

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <PageHeader
        title="Email & notifications"
        subtitle={`Everything CT Hub sends — ${s.messages} messages, in one place.`}
        back="/admin"
      />

      <div className="rounded-lg border border-gray-200 bg-gray-50/70 px-4 py-3">
        <p className="text-xs text-gray-600">
          These are set up in <b>{s.screens} different screens</b> across{' '}
          <b>{s.settingKeys} settings</b>, which is why &ldquo;who gets this mail&rdquo; has been hard to
          answer. Nothing has moved — each message still links to the screen that owns it. What is
          new is being able to see them together, and spot the ones going nowhere.
        </p>
      </div>

      {(silent > 0 || ignoring > 0) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {silent > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                {silent} {silent === 1 ? 'message reaches' : 'messages reach'} nobody
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                Switched on, but with an empty recipient list or every channel off. They run and
                deliver nothing.
              </p>
            </div>
          )}
          {ignoring > 0 && (
            <div className="rounded-lg border border-gray-300 bg-white px-4 py-3">
              <p className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Mail className="h-4 w-4 text-gray-400" />
                {ignoring} bypass the on/off switches
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                They send straight to their own address list, so turning the event off on{' '}
                <Link href="/admin/notifications" className="underline font-medium">Notifications</Link>{' '}
                has no effect on them.
              </p>
            </div>
          )}
        </div>
      )}

      <RoofClient rows={clientRows} />
    </div>
  )
}
