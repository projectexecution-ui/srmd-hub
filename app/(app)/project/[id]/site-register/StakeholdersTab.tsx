import { createClient } from '@/lib/supabase/server'
import { can, getDisabledModuleSlugs, getMyPermissions, getMyProfile, isPortalOwner } from '@/lib/auth'
import { loadStakeholders } from '@/lib/site-register/queries'
import type { OrgKind } from '@/lib/site-register/types'
import { StakeholdersClient } from './StakeholdersClient'

/**
 * Stakeholders — everyone attached to the project and their part in it.
 *
 * Consultants are a GROUP here rather than a tab of their own: the tab existed
 * to carry their cost, and a consultant pinned to their IN4 party carries it
 * in the row, from IN4, without anyone typing a figure.
 *
 * Configuring which disciplines the project uses is deliberately NOT on this
 * screen. It sits behind one button, for admins only — Aksha, 12 Sep 2026:
 * "for selecting disciplines it should be more professional hidden and shown
 * when required".
 */
const BY_PILL: Array<OrgKind | 'all'> = ['all', 'team', 'consultant', 'contractor', 'vendor']

export async function StakeholdersTab({ projectId, view = 0 }: { projectId: string; view?: number }) {
  const sb = await createClient()
  const [data, profile, owner, perms, disabled, { data: parties }, { data: users }, { data: projects }] = await Promise.all([
    loadStakeholders(projectId),
    getMyProfile(),
    isPortalOwner(),
    getMyPermissions(),
    getDisabledModuleSlugs(),
    sb.from('in4_parties').select('id, kind, name, city').eq('is_active', true).order('name').limit(4000),
    sb.from('profiles').select('id, full_name, name, email, role').eq('is_active', true).order('full_name'),
    sb.from('projects').select('id, name, short_name, code').is('archived_at', null).order('name'),
  ])

  // Configuration is narrower than use: the discipline list, who is on the
  // project, and copying either to another project.
  const canConfigure = owner || ['admin', 'head', 'founder', 'project_head'].includes(profile?.role ?? '')

  // WHO MAY SEE WHAT A PARTY HAS BEEN PAID.
  //
  // Every role holds cost-control view, so this tab opens for everyone —
  // knowing who the architect is, is not confidential. What a firm has been
  // ORDERED and PAID is: contractor-report is the module that owns that, and
  // it is deliberately off for contractor, engineer and site_staff. Reading it
  // here rather than inventing a rule means this column can never show a
  // contractor another contractor's account while /reports refuses them.
  const canSeeMoney = !disabled.has('contractor-report') && can(perms, 'contractor-report', 'view')

  type Row = Record<string, unknown>
  return (
    <StakeholdersClient
      projectId={projectId}
      projectName={data.projectName}
      initialGroup={BY_PILL[view] ?? 'all'}
      canConfigure={canConfigure}
      canSeeMoney={canSeeMoney}
      disciplines={data.all}
      enabledIds={data.enabled.map(d => d.id)}
      configured={data.configured}
      // Stripped on the server, not hidden with CSS — a figure someone may not
      // see should not be in the page they are sent.
      people={canSeeMoney ? data.people : data.people.map(p => ({ ...p, orderValue: null, paid: null, orders: 0 }))}
      gaps={data.gaps}
      parties={((parties ?? []) as Row[]).map(p => ({
        id: Number(p.id), kind: String(p.kind), name: String(p.name), city: (p.city as string) ?? null,
      }))}
      users={((users ?? []) as Row[]).map(u => ({
        id: u.id as string,
        name: (u.full_name as string) || (u.name as string) || (u.email as string) || 'Someone',
        role: (u.role as string) ?? 'viewer',
        email: (u.email as string) ?? null,
      }))}
      otherProjects={((projects ?? []) as Row[])
        .filter(p => p.id !== projectId)
        .map(p => ({ id: p.id as string, name: (p.short_name as string) || (p.name as string) || (p.code as string) || 'Project' }))}
    />
  )
}
