import { getSidebarGroups } from '@/lib/sidebar-groups.server'
import { getModuleLabels, labelFor } from '@/lib/module-labels'
import { MODULES } from '@/lib/modules'
import SidebarGroupsClient from './sidebar-groups-client'

/** Sidebar groups — the Hub door's second tab. Nest sidebar modules under
 *  named, collapsible groups. The gate is the door's. */
export async function SidebarGroupsBody() {
  const [groups, labels] = await Promise.all([getSidebarGroups(), getModuleLabels()])

  // Everything that can appear in the sidebar (same filter as NavBar): no
  // external links, no coming-soon, no admin-* (those live under Admin).
  const modules = MODULES
    .filter(m => !m.external && !m.comingSoon && !m.slug.startsWith('admin-'))
    .map(m => ({ slug: m.slug, label: labelFor(labels, m.slug) }))

  return <SidebarGroupsClient embedded initialGroups={groups} modules={modules} />
}
