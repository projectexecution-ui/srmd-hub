import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isPortalOwner, getMyProfile } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { MODULES } from '@/lib/modules'
import { getModuleLabels, labelFor, descriptionFor } from '@/lib/module-labels'
import { MODULE_GROUPS } from '../permissions/groups'
import DashboardModulesEditor from './DashboardModulesEditor'

export const dynamic = 'force-dynamic'

export default async function DashboardModulesPage() {
  if (!(await isPortalOwner())) redirect('/admin')
  const profile = await getMyProfile()
  const supabase = await createClient()

  const [{ data: visibility }, labels] = await Promise.all([
    supabase.from('module_visibility').select('slug, enabled'),
    getModuleLabels(),
  ])

  const overrides = new Map<string, boolean>(
    (visibility ?? []).map(r => [r.slug as string, r.enabled as boolean]),
  )
  const enabledFor = (slug: string) =>
    overrides.has(slug) ? !!overrides.get(slug) : true

  const modules = MODULES.map(m => ({
    slug: m.slug,
    label: labelFor(labels, m.slug),
    description: descriptionFor(labels, m.slug),
    enabled: enabledFor(m.slug),
  }))

  // Group into the same sections as the Permissions matrix so the two admin
  // screens read the same way. Any slug not listed lands in "Other".
  const bySlug = new Map(modules.map(m => [m.slug, m]))
  const used = new Set<string>()
  const groups: { title: string; rows: typeof modules }[] = []
  for (const g of MODULE_GROUPS) {
    const rows = g.slugs.map(s => bySlug.get(s)).filter(Boolean) as typeof modules
    rows.forEach(r => used.add(r.slug))
    if (rows.length) groups.push({ title: g.title, rows })
  }
  const others = modules.filter(m => !used.has(m.slug))
  if (others.length) groups.push({ title: 'Other', rows: others })

  // Portal Owner is gated by the redirect above; admin also gets to rename
  // (server-side RPC also enforces this — defence in depth).
  const canRename = !!profile?.is_portal_owner || profile?.role === 'admin'

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-4">
      <PageHeader
        title="Dashboard Modules"
        back="/admin"
        subtitle="Turn modules on / off for everyone. Click ✏️ next to a name to rename it."
      />
      <DashboardModulesEditor canRename={canRename} groups={groups} />
    </div>
  )
}
