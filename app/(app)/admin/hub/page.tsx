import { createClient } from '@/lib/supabase/server'
import { adminViewer } from '@/lib/admin/viewer'
import { doorById, resolveTab, visibleTabs } from '@/lib/admin/doors'
import { getShellMode } from '@/lib/revamp/shell-switch'
import { AdminDoor, NothingHere } from '../Door'
import { ModulesBody } from '../dashboard-modules/body'
import { SidebarGroupsBody } from '../sidebar-groups/body'
import { InternalEstimateSettingsBody } from '@/app/(app)/cost-control/settings/body'
import { ShellSwitch } from '../ShellSwitch'
import { AdminEmailRow } from '../AdminEmailRow'

export const dynamic = 'force-dynamic'
// Internal Estimate settings has a "Send me a test card" action that renders a
// card, a PDF and forwards attachments — the same room its own page gives it.
export const maxDuration = 60

/**
 * Hub — the fifth door (Aksha, 23 Sep 2026): rare switches for the whole app.
 *
 *   Modules on / off            Portal Owner only
 *   Sidebar groups
 *   Internal Estimate settings  the Cost Control switches (also at
 *                               /cost-control/settings, from inside the module)
 *   General                     the CT Hub V1 toggle and the admin e-mail —
 *                               what the old /admin/settings held
 */
export default async function HubPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [v, { tab: requested }] = await Promise.all([adminViewer(), searchParams])
  const door = doorById('hub')!
  const tabs = visibleTabs(door, v)
  const current = resolveTab(door, requested, v)
  if (!current) return <NothingHere door={door} />

  return (
    <AdminDoor door={door} tabs={tabs} current={current}>
      {current.id === 'modules' && <ModulesBody />}
      {current.id === 'sidebar' && <SidebarGroupsBody />}
      {current.id === 'estimate' && <InternalEstimateSettingsBody />}
      {current.id === 'general' && <General />}
    </AdminDoor>
  )
}

async function General() {
  const supabase = await createClient()
  const [mode, { data: emailRow }] = await Promise.all([
    getShellMode(),
    supabase.from('app_settings').select('value').eq('key', 'admin_email').maybeSingle(),
  ])
  const email = (emailRow?.value as string | null) ?? 'projectexecution@construction.srmd.org'
  return (
    <div className="space-y-4 max-w-3xl">
      <ShellSwitch mode={mode} />
      <section className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-1">Admin e-mail</p>
        <p className="text-[12px] text-gray-500 mb-2">Where access requests and the hub&apos;s own alerts go. Set once, rarely touched.</p>
        <AdminEmailRow email={email} />
      </section>
    </div>
  )
}
