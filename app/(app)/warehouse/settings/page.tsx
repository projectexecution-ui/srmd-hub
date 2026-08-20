import Link from 'next/link'
import { requirePermission, getMyPermissions, can } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { Card } from '@/components/ui/card'
import { QueryError } from '@/components/ui/query-error'
import { createClient } from '@/lib/supabase/server'
import { getSettings, getReceivers } from '@/lib/warehouse/data'
import { getAllLocations, getHideableRoles } from '@/lib/warehouse/admin-data'
import { SettingsClient } from './settings-client'
import { ChevronLeft } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default async function WarehouseSettingsPage() {
  await requirePermission('warehouse', 'view')
  const perms = await getMyPermissions()
  const canAdmin = can(perms, 'warehouse', 'admin')
  const sb = await createClient()

  const [values, locations, people, hideableRoles, listsRes, historyRes, itemsRes, projectsRes] = await Promise.all([
    getSettings(),
    getAllLocations(),
    getReceivers(),
    getHideableRoles(),
    sb.from('wh_lists').select('id, kind, value, is_active, sort').order('kind').order('sort').order('value'),
    sb.from('wh_setting_changes')
      .select('id, key, old_value, new_value, changed_at, profiles(full_name, email)')
      .order('changed_at', { ascending: false }).limit(30),
    sb.from('wh_items').select('id, source', { count: 'exact', head: true }).is('deleted_at', null),
    // For "Belongs to project" on each store — what makes a cross-project ask
    // recognisable, and so always returnable.
    sb.from('projects').select('id, name').order('name'),
  ])

  // How much each store actually holds, so "who works where" shows what a
  // keeper is being made responsible for.
  const { data: stock } = await sb.from('wh_stock').select('location_id, qty').gt('qty', 0)
  const itemsPerStore: Record<string, number> = {}
  for (const s of stock ?? []) {
    itemsPerStore[s.location_id] = (itemsPerStore[s.location_id] ?? 0) + 1
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <Link href="/warehouse" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
        <ChevronLeft className="h-3.5 w-3.5" /> Warehouse
      </Link>
      <PageHeader
        title="Warehouse settings"
        subtitle="Every switch is written as what actually happens, not as a feature name — and each says what happens when it is off, because that is the decision being made."
      />

      {listsRes.error && <QueryError message={listsRes.error.message} what="your lists" />}
      {locations.error && <QueryError message={locations.error} what="your stores" />}
      {projectsRes.error && <QueryError message={projectsRes.error.message} what="your projects" />}

      {!canAdmin && (
        <Card className="p-3 shadow-sm text-[12.5px] text-amber-900 bg-amber-50 border-amber-200">
          You can see how the warehouse is set up but not change it. These switches decide rules for
          everybody, so they are admin-only. Ask an admin for anything that needs changing.
        </Card>
      )}

      <SettingsClient
        values={values}
        sites={locations.sites}
        people={people}
        projects={projectsRes.data ?? []}
        lists={listsRes.data ?? []}
        history={historyRes.data ?? []}
        itemsPerStore={itemsPerStore}
        itemCount={itemsRes.count ?? 0}
        hideableRoles={hideableRoles}
        canAdmin={canAdmin}
      />
    </div>
  )
}
