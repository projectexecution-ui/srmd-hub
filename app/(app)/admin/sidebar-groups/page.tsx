import { redirect } from 'next/navigation'
import { isPortalOwner, getMyProfile } from '@/lib/auth'
import { getSidebarGroups } from '@/lib/sidebar-groups.server'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { MODULES } from '@/lib/modules'
import SidebarGroupsClient from './sidebar-groups-client'

export const dynamic = 'force-dynamic'

// Admin-only screen to nest sidebar modules under named, collapsible groups.
// Portal Owner or admin only (it changes everyone's side pane).
export default async function SidebarGroupsPage() {
  const [portalOwner, profile, groups, labels] = await Promise.all([
    isPortalOwner(), getMyProfile(), getSidebarGroups(), getModuleLabels(),
  ])
  if (!portalOwner && profile?.role !== 'admin') redirect('/dashboard')

  // Everything that can appear in the sidebar (same filter as NavBar): no
  // external links, no coming-soon, no admin-* (those live under the Admin hub).
  const modules = MODULES
    .filter(m => !m.external && !m.comingSoon && !m.slug.startsWith('admin-'))
    .map(m => ({ slug: m.slug, label: labelFor(labels, m.slug) }))

  return <SidebarGroupsClient initialGroups={groups} modules={modules} />
}
