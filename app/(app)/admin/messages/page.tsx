import Link from 'next/link'
import { Bell } from 'lucide-react'
import { adminViewer } from '@/lib/admin/viewer'
import { doorById, resolveTab, visibleTabs } from '@/lib/admin/doors'
import { AdminDoor, NothingHere } from '../Door'
import { ReportsBody } from '../reports/body'
import { AlertsBody } from '../notifications/body'
import { RecipientsBody } from '../notifications/recipients/body'
import { HealthBody } from '../notifications/HealthBody'

export const dynamic = 'force-dynamic'

/**
 * Messages — the third door (Aksha, 23 Sep 2026, B1: "seven screens into one").
 *
 *   Scheduled reports   every report and digest — channels, recipients, last
 *                       sent, send now. Weekly report and Bills digest are rows
 *                       here; their own settings open from the row.
 *   Instant alerts      each alert on/off per channel and role
 *   Who receives what   every message with its recipient list
 *   Mute list           every person × every message
 *   Job health          feeds, jobs, e-mail deliveries — did they run
 *
 * /admin/reports, /admin/notifications, /admin/notifications/recipients and
 * /admin/email all redirect here. The last was a copy of Who receives what.
 */
export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [v, { tab: requested }] = await Promise.all([adminViewer(), searchParams])
  const door = doorById('messages')!
  const tabs = visibleTabs(door, v)
  const current = resolveTab(door, requested, v)
  if (!current) return <NothingHere door={door} />

  const mine = (
    <Link href="/settings/notifications" className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50" title="Your own channels, phone push, Telegram">
      <Bell className="h-4 w-4" /> My notifications
    </Link>
  )

  return (
    <AdminDoor door={door} tabs={tabs} current={current} actions={mine}>
      {current.id === 'scheduled' && <ReportsBody section="reports" />}
      {current.id === 'alerts' && <AlertsBody />}
      {current.id === 'recipients' && <RecipientsBody />}
      {current.id === 'mute' && <ReportsBody section="mute" />}
      {current.id === 'health' && <HealthBody />}
    </AdminDoor>
  )
}
